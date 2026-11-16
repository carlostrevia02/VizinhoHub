import { z } from 'zod'
import { latLng, latitude, longitude, moneyNonNeg, uuid } from './common.js'

// Módulo 004 · Logística (db/migrations/004-logistica.sql).

export const FULFILLMENTS = ['PICKUP', 'DELIVERY', 'FLASH'] as const
export const fulfillmentSchema = z.enum(FULFILLMENTS)
export type Fulfillment = (typeof FULFILLMENTS)[number]

export const VEHICLES = ['MOTO', 'BIKE', 'FOOT'] as const
// BUSY é definido pelo servidor ao aceitar uma corrida; o entregador só alterna entre OFFLINE e AVAILABLE.
export const COURIER_STATUSES = ['OFFLINE', 'AVAILABLE', 'BUSY'] as const
export const DELIVERY_STATUSES = ['REQUESTED', 'OFFERED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED'] as const
export const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const
export type Vehicle = (typeof VEHICLES)[number]
export type CourierStatus = (typeof COURIER_STATUSES)[number]
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]
export type DeliveryOfferStatus = (typeof OFFER_STATUSES)[number]

// ---- Entradas -------------------------------------------------------------------------------------

// Configuração de entrega da loja (store_delivery_config).
const deliveryConfigFields = z.object({
  hasOwnFleet: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryRadiusM: z.number().int().min(100).max(10_000),
  deliveryFee: moneyNonNeg(),
  flashEnabled: z.boolean(),
  flashRadiusM: z.number().int().min(100).max(1500),
  flashFee: moneyNonNeg(),
  flashEtaMin: z.number().int().min(5).max(60),
  autoPrint: z.boolean(),
})
// CHECK flash_inside_delivery: o raio flash cabe no raio de entrega quando a entrega está ligada.
const flashInsideDelivery = (v: { deliveryEnabled?: boolean; deliveryRadiusM?: number; flashRadiusM?: number }) =>
  !v.deliveryEnabled || v.deliveryRadiusM === undefined || v.flashRadiusM === undefined || v.flashRadiusM <= v.deliveryRadiusM
const FLASH_INSIDE_MSG = 'O raio do Flash não pode passar do raio de entrega.'

export const storeDeliveryConfigSchema = deliveryConfigFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')
  .refine(flashInsideDelivery, FLASH_INSIDE_MSG)
export type StoreDeliveryConfigInput = z.infer<typeof storeDeliveryConfigSchema>

// Cadastro de entregador (couriers).
export const courierRegisterSchema = z.object({
  vehicle: z.enum(VEHICLES),
  neighborhood: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(80),
})
export type CourierRegisterInput = z.infer<typeof courierRegisterSchema>

export const courierStatusSchema = z.object({ status: z.enum(['OFFLINE', 'AVAILABLE']) })

// Ponto GPS enviado pelo entregador (~5 s) durante a corrida.
export const courierLocationSchema = latLng
export type CourierLocationInput = z.infer<typeof courierLocationSchema>

// Chamar entrega para um pedido existente (fulfillment DELIVERY/FLASH).
export const requestDeliverySchema = z.object({
  orderId: uuid,
  dropoffLat: latitude,
  dropoffLng: longitude,
})
export type RequestDeliveryInput = z.infer<typeof requestDeliverySchema>

// PIN de 4 dígitos que o cliente passa ao entregador.
export const confirmPinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, 'O PIN tem 4 dígitos.') })
export const failDeliverySchema = z.object({ reason: z.string().trim().min(1).max(500) })

export const listDeliveriesSchema = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

// ---- DTOs de saída (dinheiro como number, como em OrderDTO) --------------------------------------------

export interface StoreDeliveryConfigDTO {
  hasOwnFleet: boolean
  deliveryEnabled: boolean
  deliveryRadiusM: number
  deliveryFee: number
  flashEnabled: boolean
  flashRadiusM: number
  flashFee: number
  flashEtaMin: number
  autoPrint: boolean
}

export interface CourierDTO {
  userId: string
  name: string
  vehicle: Vehicle
  neighborhood: string
  city: string
  status: CourierStatus
  approved: boolean
  ratingAvg: number | null // 1..5
  deliveriesDone: number
  lastLat: number | null
  lastLng: number | null
  lastSeenAt: string | null
}

export interface DeliveryDTO {
  id: string
  orderId: string
  merchantId: string
  courierId: string | null
  status: DeliveryStatus
  /** Só vai para o cliente (e o lojista); nunca para o entregador. */
  pinCode?: string
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

// Convite que o entregador do pool recebe (evento `delivery:offered`).
export interface DeliveryOfferDTO {
  deliveryId: string
  courierId: string
  status: DeliveryOfferStatus
  distanceM: number | null
  courierFee: number
  storeName: string
  pickup: { lat: number; lng: number }
  dropoff: { lat: number; lng: number }
  sentAt: string
  expiresAt: string
}

// Ponto da trilha de rastreamento (evento `delivery:location`).
export interface CourierLocationDTO {
  deliveryId: string
  lat: number
  lng: number
  recordedAt: string
}
