import type { CreditAccountDTO, CreditCandidateDTO, LedgerEntryDTO } from '@vizinhohub/contracts/credit'
import type { Db, DbClient } from '../../shared/db.js'

type Queryable = Db | DbClient

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

// Telefone informado no pedido mais recente do cliente nesta loja (usado quando users.phone está vazio).
const LAST_ORDER_PHONE = `SELECT o.phone FROM orders o
        WHERE o.customer_id = c.id AND o.merchant_id = a.merchant_id AND NULLIF(trim(o.phone), '') IS NOT NULL
        ORDER BY o.created_at DESC LIMIT 1`

const ACCOUNT_SQL = `
  SELECT a.id, a.merchant_id AS "merchantId",
         json_build_object('id', c.id, 'name', c.name, 'phone', COALESCE(NULLIF(trim(c.phone), ''), (${LAST_ORDER_PHONE}))) AS customer,
         json_build_object('id', m.id, 'name', COALESCE(m.store_name, m.name)) AS merchant,
         a.credit_limit::float8 AS "creditLimit",
         a.balance::float8 AS balance,
         GREATEST(a.credit_limit - a.balance, 0)::float8 AS available,
         a.status,
         a.settlement_day AS "settlementDay",
         ${ISO('a.last_reminder_at')} AS "lastReminderAt",
         ${ISO('a.created_at')} AS "createdAt"
    FROM credit_accounts a
    JOIN users c ON c.id = a.customer_id
    JOIN users m ON m.id = a.merchant_id`

export async function findAccount(db: Queryable, id: string): Promise<CreditAccountDTO | undefined> {
  const { rows } = await db.query<CreditAccountDTO>(`${ACCOUNT_SQL} WHERE a.id = $1`, [id])
  return rows[0]
}

export async function listAccounts(
  db: Queryable,
  filter: { merchantId?: string; customerId?: string; owing?: boolean; status?: string; limit?: number },
): Promise<CreditAccountDTO[]> {
  const { rows } = await db.query<CreditAccountDTO>(
    `${ACCOUNT_SQL}
      WHERE ($1::uuid IS NULL OR a.merchant_id = $1)
        AND ($2::uuid IS NULL OR a.customer_id = $2)
        AND ($3::boolean IS NULL OR (a.balance > 0) = $3)
        AND ($4::text IS NULL OR a.status = $4)
      ORDER BY a.balance DESC, c.name
      LIMIT $5`,
    [filter.merchantId ?? null, filter.customerId ?? null, filter.owing ?? null, filter.status ?? null, filter.limit ?? 100],
  )
  return rows
}

export async function insertAccount(db: Queryable, a: { merchantId: string; customerId: string; creditLimit: number; settlementDay?: number | null }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO credit_accounts (merchant_id, customer_id, credit_limit, settlement_day) VALUES ($1, $2, $3, $4) RETURNING id`,
    [a.merchantId, a.customerId, a.creditLimit, a.settlementDay ?? null],
  )
  return rows[0]!.id
}

export async function listLedger(db: Queryable, accountId: string, limit: number): Promise<LedgerEntryDTO[]> {
  const { rows } = await db.query<LedgerEntryDTO>(
    `SELECT l.id::int AS id, l.account_id AS "accountId", l.kind, l.amount::float8 AS amount,
            l.balance_after::float8 AS "balanceAfter", l.order_id AS "orderId",
            l.payment_method AS "paymentMethod", l.note, ${ISO('l.created_at')} AS "createdAt"
       FROM credit_ledger l WHERE l.account_id = $1
      ORDER BY l.created_at DESC, l.id DESC LIMIT $2`,
    [accountId, limit],
  )
  return rows
}

// Clientes que já compraram na loja e ainda não têm caderneta, por nome. `search` casa nome ou e-mail sem acento/caixa;
// o telefone cai para o do pedido mais recente quando users.phone está vazio.
export async function listCandidates(db: Queryable, merchantId: string, q: { search?: string; limit?: number } = {}): Promise<CreditCandidateDTO[]> {
  const like = q.search ? `%${q.search.replace(/[\\%_]/g, '\\$&')}%` : null
  const { rows } = await db.query<CreditCandidateDTO>(
    `SELECT u.id, u.name,
            COALESCE(NULLIF(trim(u.phone), ''), (array_agg(o.phone ORDER BY o.created_at DESC) FILTER (WHERE NULLIF(trim(o.phone), '') IS NOT NULL))[1]) AS phone,
            count(*)::int AS orders
       FROM orders o JOIN users u ON u.id = o.customer_id
      WHERE o.merchant_id = $1
        AND NOT EXISTS (SELECT 1 FROM credit_accounts a WHERE a.merchant_id = $1 AND a.customer_id = u.id)
        AND ($2::text IS NULL OR unaccent(u.name) ILIKE unaccent($2) OR unaccent(u.email) ILIKE unaccent($2))
      GROUP BY u.id ORDER BY u.name, u.id LIMIT $3`,
    [merchantId, like, q.limit ?? 50],
  )
  return rows
}

// Dados do lojista para o Pix e o texto do lembrete.
export async function findMerchantBilling(db: Queryable, merchantId: string) {
  const { rows } = await db.query<{ name: string; city: string; pix_key: string | null }>(
    `SELECT COALESCE(store_name, name) AS name, city, store_settings->>'pixKey' AS pix_key FROM users WHERE id = $1`,
    [merchantId],
  )
  return rows[0]
}

export async function touchReminder(db: Queryable, accountId: string): Promise<void> {
  await db.query(`UPDATE credit_accounts SET last_reminder_at = now() WHERE id = $1`, [accountId])
}
