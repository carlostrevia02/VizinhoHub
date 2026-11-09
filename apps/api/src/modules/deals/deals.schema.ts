import { z } from 'zod'

// Mesmos valores dos CHECKs de `deals` (db/schema.sql) e do prompt de extração.
export const CATEGORIES = [
  'Laticínios e Ovos',
  'Hortifrúti',
  'Açougue e Peixaria',
  'Padaria e Matinais',
  'Mercearia',
  'Bebidas',
  'Higiene e Beleza',
  'Limpeza',
  'Pet Shop',
] as const
export const UNITS = ['un', 'kg', 'g', 'l', 'ml', 'pacote', 'bandeja'] as const

// Desconto mínimo (%) para a oferta virar cupom de retirada.
export const COUPON_MIN_PCT = 15
// Acima disso é quase certo erro de leitura (ou texto malicioso na página): descarta.
export const MAX_PLAUSIBLE_PCT = 90

const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true')

export const listDealsSchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  neighborhood: z.string().trim().min(1).max(80).optional(), // inclui as ofertas da rede toda (sem bairro)
  chain: z.string().trim().min(1).max(40).optional(), // slug da rede
  category: z.enum(CATEGORIES).optional(),
  couponEligible: queryBool.optional(),
  flash: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListDealsQuery = z.infer<typeof listDealsSchema>

export const idParamSchema = z.object({ id: z.uuid() })

// Uma oferta como o modelo devolve (snake_case, do prompt). Validada item a item: uma oferta
// ruim é descartada sem derrubar o encarte inteiro.
const price = z.number().positive().max(100_000)
export const extractedDealSchema = z.object({
  product_name: z.string().trim().min(2).max(200),
  category: z.enum(CATEGORIES),
  brand: z.string().trim().min(1).max(80).nullish(),
  unit: z.enum(UNITS),
  wholesale_min_qty: z.number().int().min(1).max(999).nullish(),
  original_price: price.nullish(),
  discount_price: price,
  is_flash_deal: z.boolean().nullish(),
  delivery_eligible: z.boolean().nullish(),
  raw_offer_text: z.string().trim().max(500).nullish(),
})
export type ExtractedDealRaw = z.infer<typeof extractedDealSchema>
