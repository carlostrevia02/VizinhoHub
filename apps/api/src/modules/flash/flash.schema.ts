import { z } from 'zod'

const money = z
  .number()
  .positive()
  .max(100_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais.')

export const createFlashSchema = z.object({
  productId: z.uuid(),
  offerPrice: money,
  qtyTotal: z.number().int().min(1).max(1000),
  maxPerCustomer: z.number().int().min(1).max(20).default(2),
  radiusM: z.number().int().min(100).max(10_000).default(2000),
  durationMin: z.number().int().min(5).max(720),
  reason: z.enum(['EXPIRING', 'OVERSTOCK', 'MANUAL']).default('MANUAL'),
})
export type CreateFlashInput = z.infer<typeof createFlashSchema>

export const radarQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  category: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

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

export const idParam = z.object({ id: z.uuid() })
