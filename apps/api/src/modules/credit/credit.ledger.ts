import { type DbClient, fromCents, toCents } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

// Operações do livro-razão da caderneta. Todas rodam dentro de uma transação do chamador e mudam
// credit_accounts.balance e inserem em credit_ledger NO MESMO COMMIT (saldo = soma do livro).
// A plataforma NÃO intermedeia pagamento: "pagamento" aqui é a baixa que o lojista registra à mão.
// credit_ledger só recebe INSERT (a única exceção é a retenção de 5 anos em credit.jobs.ts).

const money = (cents: number) => fromCents(cents).toFixed(2)

async function insertEntry(
  tx: DbClient,
  e: { accountId: string; kind: 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT'; amount: string; balanceAfter: string; orderId?: string | null; paymentMethod?: string | null; note?: string | null; createdBy?: string | null },
) {
  await tx.query(
    `INSERT INTO credit_ledger (account_id, kind, amount, balance_after, order_id, payment_method, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.accountId, e.kind, e.amount, e.balanceAfter, e.orderId ?? null, e.paymentMethod ?? null, e.note ?? null, e.createdBy ?? null],
  )
}

/**
 * Compra no fiado (pedido pago "na caderneta"). Anti-race: a cobrança é UM UPDATE condicional,
 * `balance + v <= credit_limit`, que o Postgres serializa por linha — sem SELECT prévio.
 * Sem conta ativa → 422 NO_CREDIT_ACCOUNT; limite estourado → 422 CREDIT_LIMIT.
 */
export async function chargeOrder(tx: DbClient, args: { orderId: string; merchantId: string; customerId: string; amount: string }): Promise<void> {
  const cents = toCents(args.amount)
  if (cents <= 0) return // pedido todo coberto pelo sinal: nada a lançar
  const { rows } = await tx.query<{ id: string; balance: string }>(
    `UPDATE credit_accounts SET balance = balance + $3::numeric
      WHERE merchant_id = $1 AND customer_id = $2 AND status = 'ACTIVE' AND balance + $3::numeric <= credit_limit
      RETURNING id, balance::text`,
    [args.merchantId, args.customerId, money(cents)],
  )
  if (!rows[0]) {
    const { rows: acc } = await tx.query<{ status: string; credit_limit: string; balance: string }>(
      `SELECT status, credit_limit::text, balance::text FROM credit_accounts WHERE merchant_id = $1 AND customer_id = $2`,
      [args.merchantId, args.customerId],
    )
    const a = acc[0]
    if (!a || a.status !== 'ACTIVE') {
      throw new AppError(422, 'NO_CREDIT_ACCOUNT', 'Você não tem caderneta ativa nesta loja. Escolha outra forma de pagamento.')
    }
    throw new AppError(422, 'CREDIT_LIMIT', 'Esta compra passa do seu limite na caderneta.', {
      creditLimit: Number(a.credit_limit),
      balance: Number(a.balance),
      available: Math.max(Number(a.credit_limit) - Number(a.balance), 0),
    })
  }
  await insertEntry(tx, { accountId: rows[0].id, kind: 'CHARGE', amount: money(cents), balanceAfter: rows[0].balance, orderId: args.orderId, note: 'Compra no fiado' })
}

/**
 * Cancelamento do pedido: devolve o valor lançado. Como a caderneta não aceita saldo negativo, se o
 * cliente já pagou parte da dívida o estorno é limitado ao saldo devedor e a diferença fica na nota
 * (o lojista devolve esse resto por fora). Sem lançamento para o pedido, não faz nada.
 */
export async function refundOrder(tx: DbClient, orderId: string): Promise<void> {
  const { rows: charge } = await tx.query<{ account_id: string; amount: string }>(
    `SELECT account_id, amount::text FROM credit_ledger WHERE order_id = $1 AND kind = 'CHARGE'`,
    [orderId],
  )
  if (!charge[0]) return
  const { rows: done } = await tx.query(`SELECT 1 FROM credit_ledger WHERE order_id = $1 AND kind = 'ADJUSTMENT'`, [orderId])
  if (done.length) return // já estornado
  const charged = toCents(charge[0].amount)
  // FOR UPDATE: o saldo lido aqui não muda até o COMMIT (pagamentos simultâneos esperam).
  const { rows: acc } = await tx.query<{ balance: string }>(`SELECT balance::text FROM credit_accounts WHERE id = $1 FOR UPDATE`, [charge[0].account_id])
  if (!acc[0]) return
  const refunded = Math.min(toCents(acc[0].balance), charged)
  if (refunded <= 0) return
  const { rows } = await tx.query<{ balance: string }>(
    `UPDATE credit_accounts SET balance = balance - $2::numeric WHERE id = $1 RETURNING balance::text`,
    [charge[0].account_id, money(refunded)],
  )
  const rest = charged - refunded
  await insertEntry(tx, {
    accountId: charge[0].account_id,
    kind: 'ADJUSTMENT',
    amount: money(-refunded),
    balanceAfter: rows[0]!.balance,
    orderId,
    note: rest > 0 ? `Estorno do pedido cancelado (parcial: R$ ${money(rest)} já quitados, devolver por fora)` : 'Estorno do pedido cancelado',
  })
}

/** Baixa manual de pagamento (o lojista recebeu por fora). Não passa do saldo devedor. */
export async function registerPayment(tx: DbClient, args: { accountId: string; merchantId: string; amount: number; paymentMethod?: string; note?: string; userId: string }) {
  const cents = toCents(args.amount)
  const { rows } = await tx.query<{ balance: string }>(
    `UPDATE credit_accounts SET balance = balance - $3::numeric WHERE id = $1 AND merchant_id = $2 AND balance >= $3::numeric RETURNING balance::text`,
    [args.accountId, args.merchantId, money(cents)],
  )
  if (!rows[0]) throw await accountOrError(tx, args.accountId, args.merchantId, 'PAYMENT_EXCEEDS_BALANCE', 'O pagamento é maior que a dívida.')
  await insertEntry(tx, { accountId: args.accountId, kind: 'PAYMENT', amount: money(-cents), balanceAfter: rows[0].balance, paymentMethod: args.paymentMethod, note: args.note, createdBy: args.userId })
}

/** Ajuste manual com sinal (+ aumenta a dívida, − reduz). A dívida nunca fica negativa. */
export async function registerAdjustment(tx: DbClient, args: { accountId: string; merchantId: string; amount: number; note: string; userId: string }) {
  const cents = toCents(args.amount)
  const { rows } = await tx.query<{ balance: string }>(
    `UPDATE credit_accounts SET balance = balance + $3::numeric WHERE id = $1 AND merchant_id = $2 AND balance + $3::numeric >= 0 RETURNING balance::text`,
    [args.accountId, args.merchantId, money(cents)],
  )
  if (!rows[0]) throw await accountOrError(tx, args.accountId, args.merchantId, 'ADJUSTMENT_BELOW_ZERO', 'O ajuste deixaria a dívida negativa.')
  await insertEntry(tx, { accountId: args.accountId, kind: 'ADJUSTMENT', amount: money(cents), balanceAfter: rows[0].balance, note: args.note, createdBy: args.userId })
}

// Conta que não é desta loja é "não encontrada"; se é, o motivo do UPDATE não casar é o da regra.
async function accountOrError(tx: DbClient, accountId: string, merchantId: string, code: string, message: string) {
  const { rows } = await tx.query(`SELECT 1 FROM credit_accounts WHERE id = $1 AND merchant_id = $2`, [accountId, merchantId])
  return rows[0] ? new AppError(422, code, message) : new AppError(404, 'CREDIT_ACCOUNT_NOT_FOUND', 'Conta da caderneta não encontrada.')
}
