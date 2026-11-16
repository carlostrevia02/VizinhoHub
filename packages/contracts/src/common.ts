import { z } from 'zod'

// Primitivos compartilhados entre API e front.

export const uuid = z.uuid()
export const idParam = z.object({ id: z.uuid() })

/** Valor com no máximo 2 casas decimais (NUMERIC(10,2) no banco). */
export const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
const TWO_DECIMALS_MSG = 'Use no máximo 2 casas decimais.'

/** Dinheiro positivo (> 0) com teto configurável. O padrão é o do módulo flash. */
export const money = (max = 100_000) => z.number().positive().max(max).refine(twoDecimals, TWO_DECIMALS_MSG)
/** Dinheiro >= 0 (taxas, limites, sinal). */
export const moneyNonNeg = (max = 99_999_999.99) => z.number().min(0).max(max).refine(twoDecimals, TWO_DECIMALS_MSG)

/** Latitude/longitude em graus (NUMERIC(9,6) no banco). */
export const latitude = z.number().min(-90).max(90)
export const longitude = z.number().min(-180).max(180)
export const latLng = z.object({ lat: latitude, lng: longitude })

/** Horário HH:MM (24 h). */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.')

/** Data YYYY-MM-DD. */
export const isoDate = z.iso.date()

/** Query string booleana ('true' | 'false'). */
export const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true')

/** Paginação por limit/offset (a API usa isso em /products; o teto varia por rota). */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type Pagination = z.infer<typeof paginationSchema>

/** Envelope de erro de toda a API: { error: { code, message, details? } }. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export interface ApiError {
  error: { code: string; message: string; details?: unknown }
}
/** Item de `details` quando code = VALIDATION_ERROR. */
export interface ValidationIssue {
  path: string
  message: string
}
