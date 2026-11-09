import { z } from 'zod'
import { FUNNEL_EVENTS } from './ops.types.js'

export const trackEventSchema = z.object({
  merchantId: z.uuid(),
  sessionId: z.uuid(),
  type: z.enum(FUNNEL_EVENTS),
  productId: z.uuid().optional(),
})

export const printAckSchema = z.object({
  ok: z.boolean(),
  error: z.string().trim().max(300).optional(),
})

export const pushSubscribeSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
  app: z.enum(['CUSTOMER', 'MERCHANT', 'COURIER']).default('CUSTOMER'),
})

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) })

export const idParam = z.object({ id: z.uuid() })
