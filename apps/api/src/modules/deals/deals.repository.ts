import type { Db, DbClient } from '../../shared/db.js'
import type { ListDealsQuery } from './deals.schema.js'
import type { ChainDTO, CouponDTO, DealDTO } from './deals.types.js'

type Queryable = Db | DbClient

// Encarte enviado vale até a validade informada. As demais ofertas, só enquanto a fonte continuar mostrando:
// não vista há mais de um dia (job parado, site fora do ar) deixa de ser confiável.
const LIVE = `d.active AND (d.valid_until > now() OR (d.valid_until IS NULL AND d.last_seen_at > now() - interval '24 hours'))`

const DEAL_SQL = `
  SELECT d.id,
         json_build_object('id', c.id, 'slug', c.slug, 'name', c.name) AS chain,
         d.neighborhood, d.product_name AS "productName", d.category, d.brand, d.unit,
         d.wholesale_min_qty AS "wholesaleMinQty",
         d.original_price::float8 AS "originalPrice",
         d.discount_price::float8 AS "discountPrice",
         d.discount_pct AS "discountPct",
         d.is_flash_deal AS "isFlashDeal",
         d.coupon_eligible AS "couponEligible",
         d.delivery_eligible AS "deliveryEligible",
         to_char(d.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastSeenAt"
    FROM deals d
    JOIN retail_chains c ON c.id = d.chain_id`

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

export async function listDeals(db: Queryable, q: ListDealsQuery): Promise<DealDTO[]> {
  const params: unknown[] = []
  const where = [LIVE, 'c.active']
  const add = (sql: string, value: unknown) => {
    params.push(value)
    const placeholder = `$${params.length}`
    where.push(sql.replaceAll('?', () => placeholder))
  }
  if (q.search) add('unaccent(d.product_name) ILIKE unaccent(?)', `%${escapeLike(q.search)}%`)
  // Ofertas da rede toda (sem bairro) valem para qualquer bairro.
  if (q.neighborhood) add('(d.neighborhood IS NULL OR unaccent(d.neighborhood) ILIKE unaccent(?))', escapeLike(q.neighborhood))
  if (q.chain) add('c.slug = ?', q.chain)
  if (q.category) add('d.category = ?', q.category)
  if (q.couponEligible !== undefined) add('d.coupon_eligible = ?::boolean', q.couponEligible)
  if (q.flash !== undefined) add('d.is_flash_deal = ?::boolean', q.flash)

  params.push(q.limit, q.offset)
  const { rows } = await db.query<DealDTO>(
    `${DEAL_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY d.discount_pct DESC NULLS LAST, d.is_flash_deal DESC, d.product_name, d.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function findDeal(db: Queryable, id: string): Promise<DealDTO | undefined> {
  const { rows } = await db.query<DealDTO>(`${DEAL_SQL} WHERE d.id = $1 AND ${LIVE} AND c.active`, [id])
  return rows[0]
}

export async function listChains(db: Queryable): Promise<ChainDTO[]> {
  const { rows } = await db.query<ChainDTO>(
    `SELECT c.id, c.slug, c.name, c.kind,
            count(d.id) FILTER (WHERE ${LIVE})::int AS "dealCount"
       FROM retail_chains c
       LEFT JOIN deals d ON d.chain_id = c.id
      WHERE c.active
      GROUP BY c.id
      ORDER BY c.name`,
  )
  return rows
}

const COUPON_SQL = `
  SELECT k.id, k.code,
         CASE WHEN k.status = 'ACTIVE' AND k.expires_at <= now() THEN 'EXPIRED' ELSE k.status::text END AS status,
         k.product_name AS "productName", k.unit_price::float8 AS "unitPrice", k.original_price::float8 AS "originalPrice",
         round((k.original_price - k.unit_price) * k.min_qty, 2)::float8 AS profit, k.min_qty AS "minQty",
         json_build_object('slug', c.slug, 'name', c.name) AS chain,
         d.neighborhood,
         to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
         to_char(k.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
         to_char(k.redeemed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "redeemedAt"
    FROM deal_coupons k
    JOIN deals d ON d.id = k.deal_id
    JOIN retail_chains c ON c.id = d.chain_id`

export async function listCoupons(db: Queryable, customerId: string): Promise<CouponDTO[]> {
  const { rows } = await db.query<CouponDTO>(`${COUPON_SQL} WHERE k.customer_id = $1 ORDER BY k.created_at DESC LIMIT 100`, [customerId])
  return rows
}

export async function findCoupon(db: Queryable, id: string): Promise<CouponDTO> {
  const { rows } = await db.query<CouponDTO>(`${COUPON_SQL} WHERE k.id = $1`, [id])
  return rows[0]!
}

// Confirma a compra numa única instrução: a condição no WHERE garante que, de dois cliques simultâneos, só um afeta a linha.
// Devolve false quando o cupom não é do cliente, não existe, já foi confirmado ou venceu.
export async function confirmCoupon(db: Queryable, couponId: string, customerId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE deal_coupons SET status = 'REDEEMED', redeemed_at = now()
      WHERE id = $1 AND customer_id = $2 AND status = 'ACTIVE' AND expires_at > now()
      RETURNING id`,
    [couponId, customerId],
  )
  return rows.length > 0
}

// Situação do cupom do cliente, para explicar por que a confirmação não valeu. undefined = não existe ou é de outro cliente.
export async function findCouponState(db: Queryable, couponId: string, customerId: string): Promise<{ status: string } | undefined> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT CASE WHEN status = 'ACTIVE' AND expires_at <= now() THEN 'EXPIRED' ELSE status::text END AS status
       FROM deal_coupons WHERE id = $1 AND customer_id = $2`,
    [couponId, customerId],
  )
  return rows[0]
}

// Fecha os cupons vencidos do cliente para a oferta (libera o índice de "um ativo por oferta").
export function expireCoupons(db: Queryable, customerId: string, dealId: string) {
  return db.query(
    `UPDATE deal_coupons SET status = 'EXPIRED' WHERE customer_id = $1 AND deal_id = $2 AND status = 'ACTIVE' AND expires_at <= now()`,
    [customerId, dealId],
  )
}

export async function insertCoupon(
  db: Queryable,
  c: { code: string; dealId: string; customerId: string; productName: string; unitPrice: number; originalPrice: number; minQty: number; ttlHours: number },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO deal_coupons (code, deal_id, customer_id, product_name, unit_price, original_price, min_qty, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8::int)) RETURNING id`,
    [c.code, c.dealId, c.customerId, c.productName, c.unitPrice, c.originalPrice, c.minQty, c.ttlHours],
  )
  return rows[0]!.id
}
