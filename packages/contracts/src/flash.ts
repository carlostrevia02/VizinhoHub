import { z } from 'zod'
import { money, uuid } from './common.js'

// Copiado de apps/api/src/modules/flash (a fonte da verdade continua sendo a API por enquanto).

export const createFlashSchema = z.object({
  productId: uuid,
  offerPrice: money(),
  qtyTotal: z.number().int().min(1).max(1000),
  maxPerCustomer: z.number().int().min(1).max(20).default(2),
  radiusM: z.number().int().min(100).max(10_000).default(2000),
  durationMin: z.number().int().min(5).max(720),
  reason: z.enum(['EXPIRING', 'OVERSTOCK', 'MANUAL']).default('MANUAL'),
})
export type CreateFlashInput = z.infer<typeof createFlashSchema>

// Edição de oferta ativa: todos os campos são opcionais, mas ao menos um precisa vir.
export const updateFlashSchema = z
  .object({
    offerPrice: money().optional(),
    qtyTotal: z.number().int().min(1).max(1000).optional(),
    maxPerCustomer: z.number().int().min(1).max(20).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Informe ao menos um campo para alterar.')
export type UpdateFlashInput = z.infer<typeof updateFlashSchema>

export const radarQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  category: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type RadarQuery = z.infer<typeof radarQuerySchema>

// Alerta de geofence do cliente; "não perturbe" exige início e fim juntos.
export const alertSchema = z
  .object({
    label: z.string().trim().min(1).max(40).default('Casa'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusM: z.number().int().min(200).max(5000).default(1500),
    categoryIds: z.array(z.number().int().positive()).max(30).nullish(),
    quietFrom: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    quietTo: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  })
  .refine((v) => Boolean(v.quietFrom) === Boolean(v.quietTo), 'Informe o início e o fim do "não perturbe".')
export type AlertInput = z.infer<typeof alertSchema>

// Item de pedido de oferta relâmpago.
export const flashOrderItemSchema = z.object({
  flashOfferId: uuid,
  quantity: z.number().int().min(1).max(20),
})
export type FlashOrderItem = z.infer<typeof flashOrderItemSchema>

export type FlashStatus = 'SCHEDULED' | 'ACTIVE' | 'SOLD_OUT' | 'ENDED' | 'CANCELLED'

// Oferta como o cliente a vê no radar.
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

// Oferta como o comerciante a vê.
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
