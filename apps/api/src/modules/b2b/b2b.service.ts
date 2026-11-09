import { z } from 'zod'
import type { AuthUser } from '../../shared/auth.js'
import type { Db } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

export const searchSchema = z
  .object({
    barcode: z.string().regex(/^\d{8,14}$/, 'Código de barras deve ter de 8 a 14 dígitos.').optional(),
    productId: z.uuid().optional(),
    radiusKm: z.coerce.number().min(0.1).max(50).default(5),
  })
  .refine((v) => v.barcode || v.productId, 'Informe barcode ou productId.')
export type SearchQuery = z.infer<typeof searchSchema>

export interface B2bOffer {
  productId: string
  merchantId: string
  storeName: string
  neighborhood: string
  city: string
  name: string
  barcode: string
  surplusQty: number
  price: number
  distanceKm: number | null // null quando uma das lojas não tem coordenadas
  sameNeighborhood: boolean
}

// Rede Anti-Ruptura: encontra o mesmo item (mesmo código de barras) com excedente em lojas vizinhas.
export function createB2bService(deps: { db: Db }) {
  const { db } = deps

  async function findOffers(merchantId: string, barcode: string | null, radiusKm: number): Promise<B2bOffer[]> {
    const { rows } = await db.query<B2bOffer>(
      `WITH me AS (SELECT neighborhood, city, latitude, longitude FROM users WHERE id = $1),
            o  AS (
              SELECT s.*,
                     CASE WHEN me.latitude IS NOT NULL AND s.latitude IS NOT NULL
                          THEN earth_distance(ll_to_earth(me.latitude, me.longitude), ll_to_earth(s.latitude, s.longitude)) / 1000.0
                     END AS dist_km,
                     (s.neighborhood = me.neighborhood AND s.city = me.city) AS same_hood
                FROM v_b2b_surplus s CROSS JOIN me
               WHERE s.merchant_id <> $1 AND ($2::text IS NULL OR s.barcode = $2)
            )
       SELECT product_id AS "productId", merchant_id AS "merchantId", store_name AS "storeName",
              neighborhood, city, name, barcode, surplus_qty AS "surplusQty", price::float8 AS price,
              round(dist_km::numeric, 2)::float8 AS "distanceKm", same_hood AS "sameNeighborhood"
         FROM o
        WHERE same_hood OR dist_km <= $3::float8
        ORDER BY dist_km NULLS LAST, surplus_qty DESC
        LIMIT 50`,
      [merchantId, barcode, radiusKm],
    )
    return rows
  }

  async function search(merchant: AuthUser, query: SearchQuery): Promise<B2bOffer[]> {
    let barcode = query.barcode ?? null
    if (query.productId) {
      const { rows } = await db.query<{ barcode: string | null }>(
        'SELECT barcode FROM products WHERE id = $1 AND user_id = $2 AND active',
        [query.productId, merchant.id],
      )
      if (!rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
      if (!rows[0].barcode) throw new AppError(422, 'NO_BARCODE', 'O produto não tem código de barras cadastrado.')
      barcode = rows[0].barcode
    }
    return findOffers(merchant.id, barcode, query.radiusKm)
  }

  // Produtos esgotados da loja (com código de barras) que algum vizinho pode suprir.
  async function alerts(merchant: AuthUser, radiusKm = 5) {
    const { rows: soldOut } = await db.query<{ id: string; name: string; barcode: string }>(
      `SELECT id, name, barcode FROM products
        WHERE user_id = $1 AND active AND stock_qty = 0 AND barcode IS NOT NULL
        ORDER BY name LIMIT 50`,
      [merchant.id],
    )
    const withOffers = await Promise.all(
      soldOut.map(async (p) => ({ productId: p.id, name: p.name, barcode: p.barcode, offers: await findOffers(merchant.id, p.barcode, radiusKm) })),
    )
    return withOffers.filter((p) => p.offers.length > 0)
  }

  return { search, alerts }
}

export type B2bService = ReturnType<typeof createB2bService>
