import { z } from 'zod'
import type { OrderDTO } from './orders.js'

// Módulo 005 · Operação da loja (funil, impressão, push).
// Copiado de apps/api/src/modules/ops (ops.schema.ts / ops.types.ts) + tipos do SQL.

export const FUNNEL_EVENTS = ['STORE_VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_START'] as const
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number]

export const PRINT_KINDS = ['TICKET', 'KITCHEN', 'RECEIPT'] as const
export const PRINT_STATUSES = ['QUEUED', 'SENT', 'PRINTED', 'FAILED'] as const
export type PrintKind = (typeof PRINT_KINDS)[number]
export type PrintStatus = (typeof PRINT_STATUSES)[number]

export const PUSH_APPS = ['CUSTOMER', 'MERCHANT', 'COURIER'] as const
export type PushApp = (typeof PUSH_APPS)[number]

export const trackEventSchema = z.object({
  merchantId: z.uuid(),
  sessionId: z.uuid(),
  type: z.enum(FUNNEL_EVENTS),
  productId: z.uuid().optional(),
})
export type TrackEventInput = z.infer<typeof trackEventSchema>

export const printAckSchema = z.object({
  ok: z.boolean(),
  error: z.string().trim().max(300).optional(),
})
export type PrintAckInput = z.infer<typeof printAckSchema>

export const pushSubscribeSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
  app: z.enum(PUSH_APPS).default('CUSTOMER'),
})
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) })

// Job de impressão já com o pedido dentro: o caixa imprime sem outra chamada.
export interface PrintJobDTO {
  id: string
  orderId: string
  kind: PrintKind
  copyNo: number
  status: PrintStatus
  attempts: number
  createdAt: string
  order: OrderDTO
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}
