import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { OpsService } from '../ops/ops.service.js'
import type { CreateFlashInput, UpdateFlashInput } from './flash.schema.js'

export interface FlashOfferDTO {
  id: string
  merchantId: string
  productId: string
  productName: string
  image: string | null
  unit: string
  storeName: string
  neighborhood: string | null
  originalPrice: number
  offerPrice: number
  discountPct: number
  qtyAvailable: number
  maxPerCustomer: number
  endsAt: string
  distanceM?: number
}

export interface MerchantFlashDTO {
  id: string
  productId: string
  productName: string
  reason: string
  originalPrice: number
  offerPrice: number
  qtyTotal: number
  qtyAvailable: number
  sold: number
  maxPerCustomer: number
  radiusM: number
  status: string
  endsAt: string
}

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

export function createFlashService(deps: { db: Db; ops?: OpsService }) {
  const { db, ops } = deps

  /** Fecha o que já passou do prazo (o job faz o mesmo de minuto em minuto; aqui é o caminho "na hora"). */
  async function expireStale(q: Pick<Db, 'query'> = db) {
    const { rowCount } = await q.query(`UPDATE flash_offers SET status = 'ENDED' WHERE status = 'ACTIVE' AND ends_at <= now()`)
    return rowCount ?? 0
  }

  async function create(merchantId: string, input: CreateFlashInput): Promise<MerchantFlashDTO> {
    const created = await withTransaction(db, async (tx) => {
      await expireStale(tx)
      const { rows } = await tx.query<{ id: string; effective: string; category_id: number; store_lat: number | null }>(
        `SELECT p.id, product_effective_price(p.price, p.is_clearance, p.expiration_date)::text AS effective, p.category_id,
                u.latitude::float8 AS store_lat
           FROM products p JOIN users u ON u.id = p.user_id
          WHERE p.id = $1 AND p.user_id = $2 AND p.active
            AND (p.expiration_date IS NULL OR p.expiration_date >= current_date)`,
        [input.productId, merchantId],
      )
      const p = rows[0]
      if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
      if (p.store_lat === null) throw new AppError(422, 'STORE_WITHOUT_LOCATION', 'Cadastre a localização da loja antes de criar ofertas relâmpago.')
      if (input.offerPrice >= Number(p.effective)) {
        throw new AppError(422, 'OFFER_NOT_CHEAPER', `O preço da oferta precisa ser menor que o preço atual (R$ ${Number(p.effective).toFixed(2).replace('.', ',')}).`)
      }

      try {
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO flash_offers (merchant_id, product_id, reason, original_price, offer_price, qty_total, qty_available, max_per_customer, radius_m, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, now() + make_interval(mins => $9))
           RETURNING id`,
          [merchantId, input.productId, input.reason, p.effective, input.offerPrice, input.qtyTotal, input.maxPerCustomer, input.radiusM, input.durationMin],
        )
        return { id: ins.rows[0]!.id, categoryId: p.category_id }
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new AppError(409, 'FLASH_ALREADY_LIVE', 'Este produto já tem uma oferta relâmpago ativa.')
        throw err
      }
    })
    void notifySubscribers(created.id) // fora da transação: a oferta já existe quando o push sai
    return (await listMine(merchantId)).find((o) => o.id === created.id)!
  }

  /** Avisa quem pediu alerta perto da loja. A tabela offer_notifications garante 1 aviso por pessoa e oferta. */
  async function notifySubscribers(offerId: string): Promise<number> {
    try {
      const { rows } = await db.query<{ user_id: string; product_name: string; offer_price: string; store_name: string; pct: number }>(
        `WITH o AS (
           SELECT f.id, f.merchant_id, f.radius_m, f.offer_price, p.name AS product_name, p.category_id, u.store_name,
                  u.latitude::float8 AS lat, u.longitude::float8 AS lng,
                  round((1 - f.offer_price / f.original_price) * 100)::int AS pct
             FROM flash_offers f JOIN products p ON p.id = f.product_id JOIN users u ON u.id = f.merchant_id
            WHERE f.id = $1 AND f.status = 'ACTIVE'),
         hit AS (
           INSERT INTO offer_notifications (offer_id, user_id)
           SELECT DISTINCT $1::uuid, s.user_id
             FROM offer_alert_subscriptions s, o
            WHERE s.active AND s.user_id <> o.merchant_id
              AND distance_m(s.latitude::float8, s.longitude::float8, o.lat, o.lng) <= LEAST(s.radius_m, o.radius_m)
              AND (s.category_ids IS NULL OR o.category_id = ANY(s.category_ids))
              AND (s.quiet_from IS NULL OR s.quiet_to IS NULL OR NOT (
                    CASE WHEN s.quiet_from <= s.quiet_to THEN localtime BETWEEN s.quiet_from AND s.quiet_to
                         ELSE localtime >= s.quiet_from OR localtime <= s.quiet_to END))
           ON CONFLICT DO NOTHING
           RETURNING user_id)
         SELECT hit.user_id, o.product_name, o.offer_price::text, o.store_name, o.pct FROM hit, o`,
        [offerId],
      )
      if (rows.length === 0) return 0
      const r = rows[0]!
      await ops?.pushToUsers(
        rows.map((x) => x.user_id),
        { title: `Tá Quentinho: ${r.pct}% OFF`, body: `${r.product_name} por R$ ${Number(r.offer_price).toFixed(2).replace('.', ',')} em ${r.store_name}. Corre, é pouco!`, url: '/radar', tag: `flash-${offerId}` },
        'CUSTOMER',
      )
      return rows.length
    } catch (err) {
      console.error('Falha ao avisar assinantes da oferta relâmpago', err)
      return 0
    }
  }

  async function listMine(merchantId: string): Promise<MerchantFlashDTO[]> {
    await expireStale()
    const { rows } = await db.query<MerchantFlashDTO>(
      `SELECT f.id, f.product_id AS "productId", p.name AS "productName", f.reason,
              f.original_price::float8 AS "originalPrice", f.offer_price::float8 AS "offerPrice",
              f.qty_total AS "qtyTotal", f.qty_available AS "qtyAvailable", (f.qty_total - f.qty_available) AS sold,
              f.max_per_customer AS "maxPerCustomer", f.radius_m AS "radiusM", f.status, ${iso('f.ends_at')} AS "endsAt"
         FROM flash_offers f JOIN products p ON p.id = f.product_id
        WHERE f.merchant_id = $1 ORDER BY f.created_at DESC LIMIT 100`,
      [merchantId],
    )
    return rows
  }

  async function cancel(merchantId: string, id: string): Promise<void> {
    const { rowCount } = await db.query(`UPDATE flash_offers SET status = 'CANCELLED' WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'`, [id, merchantId])
    if (rowCount === 0) {
      const { rows } = await db.query(`SELECT 1 FROM flash_offers WHERE id = $1 AND merchant_id = $2`, [id, merchantId])
      if (rows[0]) throw new AppError(409, 'FLASH_NOT_ACTIVE', 'Esta oferta já foi cancelada ou encerrada.')
      throw new AppError(404, 'FLASH_NOT_FOUND', 'Oferta não encontrada.')
    }
  }

  /** Edita oferta no prazo (ACTIVE ou SOLD_OUT). Trava a linha para concorrer com as compras que baixam qty_available. */
  async function update(merchantId: string, id: string, input: UpdateFlashInput): Promise<MerchantFlashDTO> {
    await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{
        status: string; original_price: string; qty_total: number; qty_available: number; max_per_customer: number
        starts_at: Date; ends_at: Date; live: boolean
      }>(
        `SELECT f.status, f.original_price::text, f.qty_total, f.qty_available, f.max_per_customer, f.starts_at, f.ends_at,
                f.ends_at > now() AS live
           FROM flash_offers f
          WHERE f.id = $1 AND f.merchant_id = $2
          FOR UPDATE OF f`,
        [id, merchantId],
      )
      const o = rows[0]
      if (!o) throw new AppError(404, 'FLASH_NOT_FOUND', 'Oferta não encontrada.')
      if (!['ACTIVE', 'SOLD_OUT'].includes(o.status) || !o.live) throw new AppError(409, 'FLASH_NOT_ACTIVE', 'Só é possível editar uma oferta ativa e dentro do prazo.')

      if (input.offerPrice !== undefined && input.offerPrice >= Number(o.original_price)) {
        throw new AppError(422, 'OFFER_NOT_CHEAPER', `O preço da oferta precisa ser menor que o preço de referência (R$ ${Number(o.original_price).toFixed(2).replace('.', ',')}).`)
      }

      let endsAt = o.ends_at
      if (input.endsAt !== undefined) {
        endsAt = new Date(input.endsAt)
        const max = new Date(o.starts_at.getTime() + 720 * 60_000)
        if (endsAt.getTime() <= Date.now()) throw new AppError(422, 'FLASH_ENDS_AT_INVALID', 'O novo prazo precisa estar no futuro.')
        if (endsAt.getTime() > max.getTime()) throw new AppError(422, 'FLASH_ENDS_AT_INVALID', 'O prazo da oferta não pode passar de 12 horas desde o início dela.', { maxEndsAt: max.toISOString() })
      }

      const sold = o.qty_total - o.qty_available // recalculado com a linha travada
      const qtyTotal = input.qtyTotal ?? o.qty_total
      if (qtyTotal < sold) throw new AppError(422, 'FLASH_QTY_BELOW_SOLD', `Já foram vendidas ${sold} unidades; a quantidade não pode ser menor.`, { sold })
      const qtyAvailable = qtyTotal - sold
      const status = qtyAvailable === 0 ? 'SOLD_OUT' : 'ACTIVE'

      await tx.query(
        `UPDATE flash_offers
            SET offer_price = COALESCE($2::numeric, offer_price), qty_total = $3, qty_available = $4,
                max_per_customer = COALESCE($5::int, max_per_customer), ends_at = $6, status = $7
          WHERE id = $1`,
        [id, input.offerPrice ?? null, qtyTotal, qtyAvailable, input.maxPerCustomer ?? null, endsAt, status],
      )
    })
    return (await listMine(merchantId)).find((o) => o.id === id)!
  }

  /** Radar do cliente: ofertas vivas cujo raio alcança (lat, lng). */
  async function radar(q: { lat: number; lng: number; category?: number; limit: number }): Promise<FlashOfferDTO[]> {
    const { rows } = await db.query<FlashOfferDTO>(
      `SELECT * FROM (
         SELECT v.id, v.merchant_id AS "merchantId", v.product_id AS "productId", v.product_name AS "productName", v.image, v.unit,
                v.store_name AS "storeName", v.neighborhood, v.original_price::float8 AS "originalPrice", v.offer_price::float8 AS "offerPrice",
                v.discount_pct AS "discountPct", v.qty_available AS "qtyAvailable", v.max_per_customer AS "maxPerCustomer",
                ${iso('v.ends_at')} AS "endsAt", v.ends_at AS _ends,
                distance_m(v.store_lat, v.store_lng, $1::float8, $2::float8)::int AS "distanceM", v.radius_m
           FROM v_flash_offers_live v
          WHERE ($3::int IS NULL OR v.category_id = $3)) x
        WHERE x."distanceM" <= x.radius_m
        ORDER BY x._ends LIMIT $4`,
      [q.lat, q.lng, q.category ?? null, q.limit],
    )
    return rows.map(({ ...r }) => {
      delete (r as Record<string, unknown>)._ends
      delete (r as Record<string, unknown>).radius_m
      return r
    })
  }

  // ---- alertas "perto de casa" ---------------------------------------------------------------------

  async function listAlerts(userId: string) {
    const { rows } = await db.query(
      `SELECT id, label, latitude::float8 AS latitude, longitude::float8 AS longitude, radius_m AS "radiusM", category_ids AS "categoryIds",
              to_char(quiet_from, 'HH24:MI') AS "quietFrom", to_char(quiet_to, 'HH24:MI') AS "quietTo", active
         FROM offer_alert_subscriptions WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    )
    return rows
  }

  async function addAlert(userId: string, a: { label: string; latitude: number; longitude: number; radiusM: number; categoryIds?: number[] | null; quietFrom?: string | null; quietTo?: string | null }) {
    const count = await db.query(`SELECT count(*)::int AS n FROM offer_alert_subscriptions WHERE user_id = $1`, [userId])
    if (count.rows[0].n >= 5) throw new AppError(422, 'TOO_MANY_ALERTS', 'Você pode ter até 5 lugares com alerta.')
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO offer_alert_subscriptions (user_id, label, latitude, longitude, radius_m, category_ids, quiet_from, quiet_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, a.label, a.latitude, a.longitude, a.radiusM, a.categoryIds ?? null, a.quietFrom ?? null, a.quietTo ?? null],
    )
    return { id: rows[0]!.id }
  }

  async function removeAlert(userId: string, id: string) {
    const { rowCount } = await db.query(`DELETE FROM offer_alert_subscriptions WHERE id = $1 AND user_id = $2`, [id, userId])
    if (rowCount === 0) throw new AppError(404, 'ALERT_NOT_FOUND', 'Alerta não encontrado.')
  }

  return { create, update, listMine, cancel, radar, expireStale, notifySubscribers, listAlerts, addAlert, removeAlert }
}

export type FlashService = ReturnType<typeof createFlashService>
