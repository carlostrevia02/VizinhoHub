import { z } from 'zod'
import { hhmm, isoDate, moneyNonNeg, uuid } from './common.js'

// Módulo 008 · Encomendas e agendamento (pickup_slots, slot_bookings, orders.scheduled_for).

// ---- Entradas -------------------------------------------------------------------------------------

// Faixa de retirada: dia da semana (0 = domingo), horário HH:MM e capacidade.
const slotFields = z.object({
  weekday: z.number().int().min(0).max(6),
  startsAt: hhmm,
  endsAt: hhmm,
  capacity: z.number().int().min(1).max(100_000),
  active: z.boolean().default(true),
})
// HH:MM com zero à esquerda compara certo como texto. CHECK (ends_at > starts_at).
export const createPickupSlotSchema = slotFields.refine((v) => v.endsAt > v.startsAt, 'O fim precisa ser depois do início.')
export type CreatePickupSlotInput = z.infer<typeof createPickupSlotSchema>

export const updatePickupSlotSchema = slotFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')
  .refine((v) => v.startsAt === undefined || v.endsAt === undefined || v.endsAt > v.startsAt, 'O fim precisa ser depois do início.')

// Vagas livres de uma loja num intervalo de datas.
export const slotAvailabilityQuerySchema = z.object({
  merchantId: uuid,
  from: isoDate,
  days: z.coerce.number().int().min(1).max(31).default(7),
})

// Dados de agendamento que acompanham o pedido.
export const scheduleOrderSchema = z.object({
  scheduledFor: z.iso.datetime({ offset: true }),
  slotId: uuid.nullish(),
  depositAmount: moneyNonNeg().default(0), // sinal
})
export type ScheduleOrderInput = z.infer<typeof scheduleOrderSchema>

// Personalização de um item (ex.: "escrever Parabéns, Ana"). O SQL é TEXT; limitamos por segurança.
export const itemCustomizationSchema = z.string().trim().min(1).max(300)

// Antecedência mínima do produto sob medida (0 = pronta entrega).
export const leadTimeSchema = z.object({ leadTimeHours: z.number().int().min(0).max(24 * 60) })

export const listScheduledOrdersSchema = z.object({
  from: isoDate,
  to: isoDate,
})

// ---- DTOs de saída ---------------------------------------------------------------------------------

export interface PickupSlotDTO {
  id: string
  merchantId: string
  weekday: number
  startsAt: string // HH:MM
  endsAt: string // HH:MM
  capacity: number
  active: boolean
}

export interface SlotAvailabilityDTO {
  slotId: string
  date: string // YYYY-MM-DD
  startsAt: string
  endsAt: string
  capacity: number
  booked: number
  free: number
}

export interface ScheduledOrderInfoDTO {
  scheduledFor: string
  slotId: string | null
  depositAmount: number
}
