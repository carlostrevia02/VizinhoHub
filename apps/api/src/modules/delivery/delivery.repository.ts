import type { Db, DbClient } from '../../shared/db.js'
import { MAX_PIN_ATTEMPTS } from './delivery.schema.js'
import type { CourierDTO, DeliveryDTO, DeliveryOfferDTO, StoreDeliveryConfigDTO } from './delivery.schema.js'

type Q = Pick<Db | DbClient, 'query'>

export const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

// ---- configuração da loja --------------------------------------------------------------------------

const CONFIG_SQL = `
  SELECT has_own_fleet AS "hasOwnFleet", delivery_enabled AS "deliveryEnabled", delivery_radius_m AS "deliveryRadiusM",
         delivery_fee::float8 AS "deliveryFee", flash_enabled AS "flashEnabled", flash_radius_m AS "flashRadiusM",
         flash_fee::float8 AS "flashFee", flash_eta_min AS "flashEtaMin", auto_print AS "autoPrint"
    FROM store_delivery_config WHERE merchant_id = $1`

export const DEFAULT_CONFIG: StoreDeliveryConfigDTO = {
  hasOwnFleet: false,
  deliveryEnabled: false,
  deliveryRadiusM: 3000,
  deliveryFee: 0,
  flashEnabled: false,
  flashRadiusM: 800,
  flashFee: 0,
  flashEtaMin: 15,
  autoPrint: true,
}

export async function findConfig(db: Q, merchantId: string): Promise<StoreDeliveryConfigDTO> {
  const { rows } = await db.query<StoreDeliveryConfigDTO>(CONFIG_SQL, [merchantId])
  return rows[0] ?? DEFAULT_CONFIG
}

// ---- entregas -------------------------------------------------------------------------------------

interface DeliveryRow {
  id: string
  orderId: string
  merchantId: string
  courierId: string | null
  status: DeliveryDTO['status']
  pinCode: string | null
  pinAttempts: number
  courierFee: number
  pickup: { lat: number; lng: number }
  dropoff: { lat: number; lng: number }
  distanceM: number | null
  requestedAt: string
  acceptedAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  failureReason: string | null
}

export const DELIVERY_COLS = `
  d.id, d.order_id AS "orderId", d.merchant_id AS "merchantId", d.courier_id AS "courierId", d.status,
  d.pin_code AS "pinCode", d.pin_attempts AS "pinAttempts", d.courier_fee::float8 AS "courierFee",
  json_build_object('lat', d.pickup_lat::float8, 'lng', d.pickup_lng::float8) AS pickup,
  json_build_object('lat', d.dropoff_lat::float8, 'lng', d.dropoff_lng::float8) AS dropoff,
  d.distance_m AS "distanceM",
  ${iso('d.requested_at')} AS "requestedAt", ${iso('d.accepted_at')} AS "acceptedAt",
  ${iso('d.picked_up_at')} AS "pickedUpAt", ${iso('d.delivered_at')} AS "deliveredAt", d.failure_reason AS "failureReason"`

/** `withPin`: o PIN só vai para o cliente e o lojista, nunca para o entregador. */
export function toDeliveryDto(row: DeliveryRow, withPin: boolean): DeliveryDTO {
  const { pinCode, pinAttempts, ...rest } = row
  return {
    ...rest,
    ...(withPin && pinCode ? { pinCode } : {}),
    pinAttempts,
    pinLocked: pinAttempts >= MAX_PIN_ATTEMPTS,
  }
}

export async function findDelivery(db: Q, id: string, withPin: boolean): Promise<DeliveryDTO | undefined> {
  const { rows } = await db.query<DeliveryRow>(`SELECT ${DELIVERY_COLS} FROM deliveries d WHERE d.id = $1`, [id])
  return rows[0] && toDeliveryDto(rows[0], withPin)
}

export async function findDeliveryByOrder(db: Q, orderId: string, withPin: boolean): Promise<DeliveryDTO | undefined> {
  const { rows } = await db.query<DeliveryRow>(`SELECT ${DELIVERY_COLS} FROM deliveries d WHERE d.order_id = $1`, [orderId])
  return rows[0] && toDeliveryDto(rows[0], withPin)
}

export async function listMerchantDeliveries(db: Q, merchantId: string, status: string | null, limit: number): Promise<DeliveryDTO[]> {
  const { rows } = await db.query<DeliveryRow>(
    `SELECT ${DELIVERY_COLS} FROM deliveries d
      WHERE d.merchant_id = $1 AND ($2::text IS NULL OR d.status = $2)
      ORDER BY d.requested_at DESC LIMIT $3`,
    [merchantId, status, limit],
  )
  return rows.map((r) => toDeliveryDto(r, true))
}

// ---- entregadores ---------------------------------------------------------------------------------

export async function findCourier(db: Q, userId: string): Promise<CourierDTO | undefined> {
  const { rows } = await db.query<CourierDTO>(
    `SELECT c.user_id AS "userId", u.name, c.vehicle, c.neighborhood, c.city, c.status, c.approved,
            c.rating_avg::float8 AS "ratingAvg", c.deliveries_done AS "deliveriesDone",
            c.last_lat::float8 AS "lastLat", c.last_lng::float8 AS "lastLng", ${iso('c.last_seen_at')} AS "lastSeenAt"
       FROM couriers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1`,
    [userId],
  )
  return rows[0]
}

// ---- convites -------------------------------------------------------------------------------------

export const OFFER_COLS = `
  o.delivery_id AS "deliveryId", o.courier_id AS "courierId", o.status, o.distance_m AS "distanceM",
  d.courier_fee::float8 AS "courierFee", COALESCE(u.store_name, u.name) AS "storeName",
  json_build_object('lat', d.pickup_lat::float8, 'lng', d.pickup_lng::float8) AS pickup,
  json_build_object('lat', d.dropoff_lat::float8, 'lng', d.dropoff_lng::float8) AS dropoff,
  ${iso('o.sent_at')} AS "sentAt", ${iso('o.expires_at')} AS "expiresAt"`

export async function listOpenOffers(db: Q, courierId: string): Promise<DeliveryOfferDTO[]> {
  const { rows } = await db.query<DeliveryOfferDTO>(
    `SELECT ${OFFER_COLS}
       FROM delivery_offers o
       JOIN deliveries d ON d.id = o.delivery_id
       JOIN users u ON u.id = d.merchant_id
      WHERE o.courier_id = $1 AND o.status = 'PENDING' AND o.expires_at > now()
        AND d.courier_id IS NULL AND d.status IN ('REQUESTED', 'OFFERED')
      ORDER BY o.sent_at DESC`,
    [courierId],
  )
  return rows
}

export async function listOffersOfDelivery(db: Q, deliveryId: string): Promise<DeliveryOfferDTO[]> {
  const { rows } = await db.query<DeliveryOfferDTO>(
    `SELECT ${OFFER_COLS}
       FROM delivery_offers o
       JOIN deliveries d ON d.id = o.delivery_id
       JOIN users u ON u.id = d.merchant_id
      WHERE o.delivery_id = $1 AND o.status = 'PENDING'`,
    [deliveryId],
  )
  return rows
}
