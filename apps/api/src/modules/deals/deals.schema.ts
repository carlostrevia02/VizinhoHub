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

// Localização do cliente (?lat=&lng=): ambos ou nenhum. `''` não vira 0 (z.coerce.number() transformaria): é inválido.
const coordinate = (min: number, max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .transform(Number)
    .pipe(z.number().min(min).max(max))
    .describe(`${what} do cliente (graus decimais, de ${min} a ${max}). Informe junto com ${what === 'Latitude' ? 'lng' : 'lat'}.`)
export const locationFields = {
  lat: coordinate(-90, 90, 'Latitude').optional(),
  lng: coordinate(-180, 180, 'Longitude').optional(),
}
export const bothCoordsOrNone = (v: { lat?: number; lng?: number }) => (v.lat === undefined) === (v.lng === undefined)
export const bothCoordsMessage = { message: 'Informe lat e lng juntos (ou nenhum dos dois).', path: ['lng'] }

export const listDealsSchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    neighborhood: z.string().trim().min(1).max(80).optional(), // inclui as ofertas da rede toda (sem bairro)
    chain: z.string().trim().min(1).max(40).optional(), // slug da rede
    category: z.enum(CATEGORIES).optional(),
    couponEligible: queryBool.optional(),
    flash: queryBool.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    ...locationFields, // com lat/lng, cada oferta traz a filial mais próxima (nearestBranch)
  })
  .refine(bothCoordsOrNone, bothCoordsMessage)
export type ListDealsQuery = z.infer<typeof listDealsSchema>

// GET /deals/:id aceita só a localização.
export const dealLocationSchema = z.object(locationFields).refine(bothCoordsOrNone, bothCoordsMessage)
export type DealLocationQuery = z.infer<typeof dealLocationSchema>

export const chainSlugParamSchema = z.object({ slug: z.string().trim().min(1).max(40) })

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

// ---- Encarte já estruturado (POST /deals/flyers/structured) ----------------------------------------------------
// O chat (Claude) leu a imagem do encarte e manda as ofertas prontas, em camelCase como o resto da API. Cada oferta é
// validada à parte (uma ruim não derruba as outras); depois passa pela MESMA normalização do extrator (normalizeDeal).
export const structuredDealSchema = z.object({
  productName: z.string().trim().min(2).max(200),
  category: z.enum(CATEGORIES),
  brand: z.string().trim().min(1).max(80).nullish(),
  unit: z.enum(UNITS),
  wholesaleMinQty: z.number().int().min(1).max(999).nullish(),
  originalPrice: price.nullish(),
  discountPrice: price,
  isFlashDeal: z.boolean().nullish(),
  deliveryEligible: z.boolean().nullish(),
  rawOfferText: z.string().trim().max(500).nullish(),
})
export type StructuredDeal = z.infer<typeof structuredDealSchema>

export const MAX_STRUCTURED_DEALS = 200
export const structuredFlyerSchema = z.object({
  chain: z.string().trim().min(1).max(40), // slug da rede
  neighborhood: z.string().trim().min(1).max(80).optional(),
  validDays: z.number().int().min(1).max(30).default(7), // validade do encarte
  // Encarte de várias páginas: envie cada uma com append=true para não apagar as ofertas das anteriores.
  append: z.boolean().default(false),
  fileName: z.string().trim().max(200).optional(),
  // Cada item é validado individualmente com structuredDealSchema (aqui só se exige uma lista de 1 a 200).
  deals: z.array(z.unknown()).min(1).max(MAX_STRUCTURED_DEALS),
})
export type StructuredFlyerBody = z.infer<typeof structuredFlyerSchema>

// Corpo como a documentação mostra (ofertas já tipadas); a validação real é item a item.
export const structuredFlyerDocSchema = structuredFlyerSchema.extend({ deals: z.array(structuredDealSchema).min(1).max(MAX_STRUCTURED_DEALS) })

// Converte a oferta estruturada (camelCase) para o formato do extrator (snake_case), que normalizeDeal consome.
export const toExtractedRaw = (d: StructuredDeal): ExtractedDealRaw => ({
  product_name: d.productName,
  category: d.category,
  brand: d.brand,
  unit: d.unit,
  wholesale_min_qty: d.wholesaleMinQty,
  original_price: d.originalPrice,
  discount_price: d.discountPrice,
  is_flash_deal: d.isFlashDeal,
  delivery_eligible: d.deliveryEligible,
  raw_offer_text: d.rawOfferText,
})
