import type { DbClient } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

// Cotação de entrega no checkout. Usado pelo módulo `orders` (uma chamada em createOrder).

export interface DeliveryQuote {
  /** Taxa em reais, como string NUMERIC. */
  fee: string
  lat: number
  lng: number
  distanceM: number
}

/**
 * Valida a entrega pedida (loja entrega? destino informado? dentro do raio?) e devolve a taxa da loja.
 * Fora do raio → 422 OUT_OF_RADIUS. A distância é calculada no banco (distance_m).
 */
export async function quoteDelivery(tx: Pick<DbClient, 'query'>, merchantId: string, to: { lat?: number; lng?: number }): Promise<DeliveryQuote> {
  if (to.lat === undefined || to.lng === undefined) {
    throw new AppError(422, 'DELIVERY_LOCATION_REQUIRED', 'Informe o endereço de entrega com a localização (latitude e longitude).')
  }
  const { rows } = await tx.query<{ enabled: boolean | null; radius: number | null; fee: string | null; store_lat: number | null; dist: number | null }>(
    `SELECT c.delivery_enabled AS enabled, c.delivery_radius_m AS radius, c.delivery_fee::text AS fee,
            u.latitude::float8 AS store_lat,
            CASE WHEN u.latitude IS NULL THEN NULL
                 ELSE distance_m(u.latitude::float8, u.longitude::float8, $2::float8, $3::float8) END AS dist
       FROM users u LEFT JOIN store_delivery_config c ON c.merchant_id = u.id
      WHERE u.id = $1`,
    [merchantId, to.lat, to.lng],
  )
  const r = rows[0]
  if (!r?.enabled) throw new AppError(422, 'DELIVERY_UNAVAILABLE', 'Esta loja não está fazendo entregas. Escolha retirar na loja.')
  if (r.store_lat === null || r.dist === null) throw new AppError(422, 'STORE_WITHOUT_LOCATION', 'A loja ainda não cadastrou a localização.')
  const distanceM = Math.round(r.dist)
  if (distanceM > r.radius!) {
    throw new AppError(422, 'OUT_OF_RADIUS', `Seu endereço está fora da área de entrega desta loja (${(r.radius! / 1000).toFixed(1).replace('.', ',')} km).`, {
      distanceM,
      radiusM: r.radius,
    })
  }
  return { fee: r.fee!, lat: to.lat, lng: to.lng, distanceM }
}

/** Grava no pedido recém-criado como ele chega ao cliente. */
export async function saveOrderDelivery(tx: Pick<DbClient, 'query'>, orderId: string, quote: DeliveryQuote): Promise<void> {
  await tx.query(
    `UPDATE orders SET fulfillment = 'DELIVERY', delivery_fee = $2, delivery_lat = $3, delivery_lng = $4,
            delivery_method = COALESCE(delivery_method, 'Entrega no bairro')
      WHERE id = $1`,
    [orderId, quote.fee, quote.lat, quote.lng],
  )
}
