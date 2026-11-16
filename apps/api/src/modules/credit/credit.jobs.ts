import type { Db } from '../../shared/db.js'
import type { OpsService } from '../ops/ops.service.js'
import { brl } from './credit.service.js'

// Jobs diários da caderneta: lembretes de cobrança e retenção de 5 anos (LGPD).

export interface ReminderOptions {
  /** Só cobra quem está há mais de N dias sem pagar (e com compra mais velha que isso). */
  overdueDays?: number
  /** Intervalo mínimo entre dois lembretes da mesma conta. */
  minIntervalDays?: number
}

/**
 * Lembra (push no app do cliente) quem deve: saldo > 0, conta ativa, sem pagamento nos últimos
 * `overdueDays` dias, com cobrança mais antiga que isso e sem lembrete nos últimos `minIntervalDays`.
 * Marca `last_reminder_at` de forma atômica (UPDATE ... RETURNING): duas execuções simultâneas não duplicam.
 * O lojista tem ainda o botão "lembrar no WhatsApp"; este job só avisa dentro do app, sem custo.
 */
export async function runCreditReminders(deps: { db: Db; ops?: Pick<OpsService, 'pushToUsers'> }, opts: ReminderOptions = {}): Promise<number> {
  const overdue = opts.overdueDays ?? 30
  const interval = opts.minIntervalDays ?? 7
  const { rows } = await deps.db.query<{ customer_id: string; balance: string; store: string }>(
    `UPDATE credit_accounts a SET last_reminder_at = now()
       FROM users m
      WHERE m.id = a.merchant_id AND a.balance > 0 AND a.status = 'ACTIVE'
        AND COALESCE((SELECT max(l.created_at) FROM credit_ledger l WHERE l.account_id = a.id AND l.kind = 'PAYMENT'), a.created_at) < now() - make_interval(days => $1::int)
        AND EXISTS (SELECT 1 FROM credit_ledger l WHERE l.account_id = a.id AND l.kind = 'CHARGE' AND l.created_at < now() - make_interval(days => $1::int))
        AND (a.last_reminder_at IS NULL OR a.last_reminder_at < now() - make_interval(days => $2::int))
      RETURNING a.customer_id, a.balance::text, COALESCE(m.store_name, m.name) AS store`,
    [overdue, interval],
  )
  for (const r of rows) {
    void deps.ops?.pushToUsers([r.customer_id], { title: 'Caderneta em aberto', body: `Você tem ${brl(Number(r.balance))} para acertar com ${r.store}.`, url: '/conta', tag: 'credit-reminder' }, 'CUSTOMER')
  }
  return rows.length
}

/**
 * Retenção de 5 anos (LGPD): o livro fica 5 anos. Passado esse prazo, SOME a conta inteira (livro + conta)
 * quando ela está quitada (saldo 0) e sem nenhum lançamento nem edição recente. Escolha deliberada: apagar só
 * os lançamentos antigos de uma conta ativa quebraria "saldo = soma do livro"; conta quitada e parada há
 * 5 anos não precisa de saldo de abertura, pois some inteira. Contas com movimento recente mantêm todo o histórico.
 * É a única exceção à regra "credit_ledger só recebe INSERT".
 */
export async function runCreditRetention(db: Db, years = 5): Promise<{ accounts: number; entries: number }> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>(
      `SELECT a.id FROM credit_accounts a
        WHERE a.balance = 0 AND a.created_at < now() - make_interval(years => $1::int)
          AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.account_id = a.id AND l.created_at >= now() - make_interval(years => $1::int))
          FOR UPDATE`,
      [years],
    )
    const ids = rows.map((r) => r.id)
    let entries = 0
    if (ids.length) {
      entries = (await client.query(`DELETE FROM credit_ledger WHERE account_id = ANY($1::uuid[])`, [ids])).rowCount ?? 0
      await client.query(`DELETE FROM credit_accounts WHERE id = ANY($1::uuid[])`, [ids])
    }
    await client.query('COMMIT')
    return { accounts: ids.length, entries }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Roda ao subir e a cada 24 h; o timer não segura o processo aberto. Retorna a função que para.
export function startCreditJobs(deps: { db: Db; ops?: Pick<OpsService, 'pushToUsers'> }, intervalMs = 24 * 60 * 60 * 1000) {
  const run = async () => {
    try {
      const reminded = await runCreditReminders(deps)
      const purged = await runCreditRetention(deps.db)
      if (reminded || purged.accounts) console.log(`Caderneta: ${reminded} lembrete(s) · ${purged.accounts} conta(s) vencida(s) pela retenção de 5 anos (${purged.entries} lançamento(s)).`)
    } catch (err) {
      console.error('Falha nos jobs da caderneta', err)
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
