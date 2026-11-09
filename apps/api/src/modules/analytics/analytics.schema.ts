import { z } from 'zod'
import { ORDER_STATUSES, VALID_STATUSES, type OrderStatus } from './analytics.types.js'

export const MAX_DAYS = 366

// `status`: "valid" (padrão: tudo menos cancelados), "all", ou uma lista separada por vírgula
// ("COMPLETED,READY"). Sempre vira uma lista de status válidos do enum.
const statusParam = z
  .string()
  .default('valid')
  .transform((raw): string[] => {
    const v = raw.trim().toLowerCase()
    if (v === 'valid') return [...VALID_STATUSES]
    if (v === 'all') return [...ORDER_STATUSES]
    return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  })
  .pipe(z.array(z.enum(ORDER_STATUSES)).min(1).transform((list): OrderStatus[] => [...new Set(list)]))

export const dashboardQuerySchema = z.object({
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  status: statusParam,
  /** Quantos produtos aparecem no gráfico da Curva ABC. */
  abcTop: z.coerce.number().int().min(5).max(100).default(30),
})
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>
