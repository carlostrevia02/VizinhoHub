import type {
  VipInvoiceDTO,
  VipMerchantDTO,
  VipMerchantStatsDTO,
  VipPlanDTO,
  VipSubscriptionDTO,
} from '@vizinhohub/contracts/vip'
import type { Db, DbClient } from '../../shared/db.js'

type Q = Db | DbClient

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

// ---- planos ----------------------------------------------------------------------------------------

const PLAN_SQL = `
  SELECT p.id, p.code, p.name, p.price_monthly::float8 AS "priceMonthly", p.free_delivery AS "freeDelivery",
         p.free_delivery_min_order::float8 AS "freeDeliveryMinOrder", p.active,
         coalesce((SELECT json_agg(json_build_object('minMonths', t.min_months, 'discountPct', t.discount_pct::float8) ORDER BY t.min_months)
                     FROM vip_tiers t WHERE t.plan_id = p.id), '[]'::json) AS tiers
    FROM vip_plans p`

export async function listPlans(db: Q, onlyActive = true): Promise<VipPlanDTO[]> {
  const { rows } = await db.query<VipPlanDTO>(`${PLAN_SQL} WHERE ($1::boolean = FALSE OR p.active) ORDER BY p.price_monthly, p.id`, [onlyActive])
  return rows
}

export async function findPlan(db: Q, id: number): Promise<VipPlanDTO | undefined> {
  const { rows } = await db.query<VipPlanDTO>(`${PLAN_SQL} WHERE p.id = $1`, [id])
  return rows[0]
}

// ---- assinaturas -----------------------------------------------------------------------------------

const SUB_SQL = `
  SELECT s.id, s.plan_id AS "planId", s.status,
         ${iso('s.started_at')} AS "startedAt",
         ${iso('s.current_period_start')} AS "currentPeriodStart",
         ${iso('s.current_period_end')} AS "currentPeriodEnd",
         s.cancel_at_period_end AS "cancelAtPeriodEnd",
         ${iso('s.cancelled_at')} AS "cancelledAt",
         CASE WHEN s.status = 'ACTIVE' AND s.current_period_end > now() THEN vip_discount_pct(s.user_id)::float8 ELSE 0 END AS "discountPct"
    FROM vip_subscriptions s`

/** Assinatura vigente (ACTIVE ou PAST_DUE) ou, na falta, a mais recente. */
export async function findCurrentSubscription(db: Q, userId: string): Promise<VipSubscriptionDTO | undefined> {
  const { rows } = await db.query<VipSubscriptionDTO>(
    `${SUB_SQL} WHERE s.user_id = $1
      ORDER BY (s.status IN ('ACTIVE', 'PAST_DUE')) DESC, s.started_at DESC LIMIT 1`,
    [userId],
  )
  return rows[0]
}

export interface SubscriptionRow {
  id: string
  user_id: string
  plan_id: number
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED'
  current_period_end: Date
  cancel_at_period_end: boolean
  provider: string | null
  provider_sub_ref: string | null
}

export async function lockSubscription(db: DbClient, id: string): Promise<SubscriptionRow | undefined> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT id, user_id, plan_id, status, current_period_end, cancel_at_period_end, provider, provider_sub_ref
       FROM vip_subscriptions WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return rows[0]
}

export async function findLiveSubscriptionRow(db: Q, userId: string): Promise<SubscriptionRow | undefined> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT id, user_id, plan_id, status, current_period_end, cancel_at_period_end, provider, provider_sub_ref
       FROM vip_subscriptions WHERE user_id = $1 AND status IN ('ACTIVE', 'PAST_DUE')`,
    [userId],
  )
  return rows[0]
}

export async function findSubscriptionByProviderRef(db: DbClient, provider: string, ref: string): Promise<SubscriptionRow | undefined> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT id, user_id, plan_id, status, current_period_end, cancel_at_period_end, provider, provider_sub_ref
       FROM vip_subscriptions WHERE provider = $1 AND provider_sub_ref = $2`,
    [provider, ref],
  )
  return rows[0]
}

// Nasce PAST_DUE ("aguardando pagamento"): só vira ACTIVE quando a 1ª fatura for paga.
export async function insertSubscription(
  db: DbClient,
  s: { userId: string; planId: number; provider: string; customerRef: string; subRef: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO vip_subscriptions (user_id, plan_id, status, current_period_end, provider, provider_customer_ref, provider_sub_ref)
     VALUES ($1, $2, 'PAST_DUE', now(), $3, $4, $5) RETURNING id`,
    [s.userId, s.planId, s.provider, s.customerRef, s.subRef],
  )
  return rows[0]!.id
}

// ---- faturas ---------------------------------------------------------------------------------------

const INVOICE_SQL = `
  SELECT i.id, i.subscription_id AS "subscriptionId", i.period_start::text AS "periodStart", i.period_end::text AS "periodEnd",
         i.amount::float8 AS amount, i.status, i.provider, i.provider_ref AS "providerRef",
         ${iso('i.paid_at')} AS "paidAt", ${iso('i.created_at')} AS "createdAt"
    FROM vip_invoices i`

export async function listInvoices(db: Q, userId: string): Promise<VipInvoiceDTO[]> {
  const { rows } = await db.query<VipInvoiceDTO>(
    `${INVOICE_SQL} JOIN vip_subscriptions s ON s.id = i.subscription_id
      WHERE s.user_id = $1 ORDER BY i.created_at DESC, i.period_start DESC LIMIT 100`,
    [userId],
  )
  return rows
}

export async function findPendingInvoice(db: Q, subscriptionId: string): Promise<(VipInvoiceDTO & { paymentUrl: string | null }) | undefined> {
  const { rows } = await db.query<VipInvoiceDTO & { paymentUrl: string | null }>(
    `SELECT i.id, i.subscription_id AS "subscriptionId", i.period_start::text AS "periodStart", i.period_end::text AS "periodEnd",
            i.amount::float8 AS amount, i.status, i.provider, i.provider_ref AS "providerRef",
            ${iso('i.paid_at')} AS "paidAt", ${iso('i.created_at')} AS "createdAt", i.payment_url AS "paymentUrl"
       FROM vip_invoices i WHERE i.subscription_id = $1 AND i.status = 'PENDING' ORDER BY i.period_start LIMIT 1`,
    [subscriptionId],
  )
  return rows[0]
}

export async function insertInvoice(
  db: Q,
  i: { subscriptionId: string; periodStart: string; periodEnd: string; amount: number; provider: string; providerRef: string | null; paymentUrl?: string | null },
): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO vip_invoices (subscription_id, period_start, period_end, amount, provider, provider_ref, payment_url)
     VALUES ($1, $2::date, $3::date, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [i.subscriptionId, i.periodStart, i.periodEnd, i.amount, i.provider, i.providerRef, i.paymentUrl ?? null],
  )
  return rows[0]?.id
}

export interface InvoiceRow {
  id: string
  subscription_id: string
  status: 'PENDING' | 'PAID' | 'FAILED' | 'VOID'
  period_end: string
  amount: string
}

export async function findInvoiceByRef(db: DbClient, provider: string, ref: string): Promise<InvoiceRow | undefined> {
  const { rows } = await db.query<InvoiceRow>(
    `SELECT id, subscription_id, status, period_end::text, amount::text FROM vip_invoices WHERE provider = $1 AND provider_ref = $2`,
    [provider, ref],
  )
  return rows[0]
}

/** Fatura aberta sem referência do provedor ainda (criada na assinatura antes de o gateway devolver a cobrança). */
export async function findUnreferencedInvoice(db: DbClient, subscriptionId: string): Promise<InvoiceRow | undefined> {
  const { rows } = await db.query<InvoiceRow>(
    `SELECT id, subscription_id, status, period_end::text, amount::text FROM vip_invoices
      WHERE subscription_id = $1 AND status = 'PENDING' AND provider_ref IS NULL ORDER BY period_start LIMIT 1`,
    [subscriptionId],
  )
  return rows[0]
}

export async function setInvoiceRef(db: DbClient, id: string, ref: string, paymentUrl?: string): Promise<void> {
  await db.query(`UPDATE vip_invoices SET provider_ref = $2, payment_url = coalesce($3, payment_url) WHERE id = $1 AND provider_ref IS NULL`, [id, ref, paymentUrl ?? null])
}

/**
 * Fatura do ciclo seguinte: começa onde a última terminou (+1 mês). O preço vem do plano da assinatura.
 * ON CONFLICT: o job reexecutado (ou o webhook que chega antes) não duplica o ciclo.
 */
export async function insertNextInvoice(
  db: Q,
  subscriptionId: string,
  i: { provider: string; providerRef: string | null; paymentUrl?: string | null },
): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO vip_invoices (subscription_id, period_start, period_end, amount, provider, provider_ref, payment_url)
     SELECT s.id, last.e, (last.e + interval '1 month')::date, p.price_monthly, $2, $3, $4
       FROM vip_subscriptions s
       JOIN vip_plans p ON p.id = s.plan_id
       CROSS JOIN LATERAL (SELECT coalesce(max(period_end), current_date) AS e FROM vip_invoices WHERE subscription_id = s.id) last
      WHERE s.id = $1
     ON CONFLICT DO NOTHING RETURNING id`,
    [subscriptionId, i.provider, i.providerRef, i.paymentUrl ?? null],
  )
  return rows[0]?.id
}

// ---- webhooks --------------------------------------------------------------------------------------

/** true se o evento é novo (e fica registrado); false se já foi processado. Usa a transação do chamador. */
export async function registerWebhookEvent(db: DbClient, provider: string, eventId: string, type: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO vip_webhook_events (provider, event_id, event_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [provider, eventId, type],
  )
  return (rowCount ?? 0) > 0
}

// ---- lojista ---------------------------------------------------------------------------------------

const MERCHANT_SQL = `
  SELECT merchant_id AS "merchantId", discount_enabled AS "discountEnabled", discount_cap_pct::float8 AS "discountCapPct",
         funds_free_delivery AS "fundsFreeDelivery", ${iso('enrolled_at')} AS "enrolledAt"
    FROM vip_merchants`

export async function findMerchant(db: Q, merchantId: string): Promise<VipMerchantDTO | undefined> {
  const { rows } = await db.query<VipMerchantDTO>(`${MERCHANT_SQL} WHERE merchant_id = $1`, [merchantId])
  return rows[0]
}

export async function upsertMerchant(
  db: Q,
  merchantId: string,
  s: { discountEnabled?: boolean; discountCapPct?: number; fundsFreeDelivery?: boolean },
): Promise<VipMerchantDTO> {
  // Na adesão, o que não vier usa o padrão da tabela; numa atualização, o que não vier é mantido.
  await db.query(
    `INSERT INTO vip_merchants (merchant_id, discount_enabled, discount_cap_pct, funds_free_delivery)
     VALUES ($1, coalesce($2::boolean, TRUE), coalesce($3::numeric, 10), coalesce($4::boolean, FALSE))
     ON CONFLICT (merchant_id) DO UPDATE SET
       discount_enabled    = coalesce($2::boolean, vip_merchants.discount_enabled),
       discount_cap_pct    = coalesce($3::numeric, vip_merchants.discount_cap_pct),
       funds_free_delivery = coalesce($4::boolean, vip_merchants.funds_free_delivery)`,
    [merchantId, s.discountEnabled ?? null, s.discountCapPct ?? null, s.fundsFreeDelivery ?? null],
  )
  return (await findMerchant(db, merchantId))!
}

export async function deleteMerchant(db: Q, merchantId: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM vip_merchants WHERE merchant_id = $1`, [merchantId])
  return (rowCount ?? 0) > 0
}

// Pedidos não cancelados com benefício VIP.
export async function merchantStats(db: Q, merchantId: string): Promise<VipMerchantStatsDTO> {
  const { rows } = await db.query<VipMerchantStatsDTO>(
    `SELECT count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers, coalesce(sum(vip_savings), 0)::float8 AS "totalSavings"
       FROM orders WHERE merchant_id = $1 AND vip_savings > 0 AND status <> 'CANCELLED'`,
    [merchantId],
  )
  return rows[0]!
}
