import { z } from 'zod'

const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true')

export const listProductsSchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  category: z.coerce.number().int().positive().optional(),
  merchantId: z.uuid().optional(),
  clearance: queryBool.optional(), // true = só ofertas do Salva-Estoque
  inStock: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListProductsQuery = z.infer<typeof listProductsSchema>

const money = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais.')

// Campos do produto SEM valores padrão: o PUT parcial não pode "preencher" o que o cliente não enviou.
const productFields = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullish(),
  categoryId: z.number().int().positive(),
  price: money,
  unit: z.string().trim().min(1).max(20),
  image: z.string().trim().max(255).nullish(),
  expirationDate: z.iso.date().nullish(),
  // Rede Anti-Ruptura B2B
  allowB2bSharing: z.boolean(),
  barcode: z.string().regex(/^\d{8,14}$/, 'Código de barras deve ter de 8 a 14 dígitos.').nullish(),
  b2bReserveQty: z.number().int().min(0),
})

// Cadastro: os padrões entram só aqui.
export const createProductSchema = productFields.extend({
  unit: productFields.shape.unit.default('Unidade'),
  allowB2bSharing: productFields.shape.allowB2bSharing.default(false),
  b2bReserveQty: productFields.shape.b2bReserveQty.default(0),
  stockQty: z.number().int().min(0).max(1_000_000).default(0),
})
export type CreateProductInput = z.infer<typeof createProductSchema>

// Estoque não muda por PUT (só por PATCH /:id/stock, que é atômico).
export const updateProductSchema = productFields
  .partial()
  .extend({ active: z.boolean().optional(), version: z.number().int().positive().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')
export type UpdateProductInput = z.infer<typeof updateProductSchema>

// Entrada/saída rápida (delta) ou contagem de inventário (set).
export const adjustStockSchema = z.union([
  z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'delta não pode ser 0') }),
  z.object({ set: z.number().int().min(0).max(1_000_000) }),
])
export type AdjustStockInput = z.infer<typeof adjustStockSchema>

export const idParamSchema = z.object({ id: z.uuid() })
