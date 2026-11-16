import { z } from 'zod'
import { latLng } from './common.js'

// Módulo 007 · Carrinho Inteligente (db/migrations/007-carrinho-inteligente.sql).

export const UNIT_KINDS = ['UN', 'KG', 'L'] as const
export type UnitKind = (typeof UNIT_KINDS)[number]

// NUMERIC(10,3): até 7 dígitos inteiros e 3 decimais, sempre > 0.
const qty = z
  .number()
  .positive()
  .max(9_999_999.999)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Use no máximo 3 casas decimais.')

// ---- Entradas -------------------------------------------------------------------------------------

export const createCanonicalProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  categoryId: z.number().int().positive().nullish(),
  unitKind: z.enum(UNIT_KINDS).default('UN'),
  barcode: z.string().regex(/^\d{8,14}$/, 'Código de barras deve ter de 8 a 14 dígitos.').nullish(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
})
export type CreateCanonicalProductInput = z.infer<typeof createCanonicalProductSchema>

// Vincula um produto da loja ao item canônico (null desvincula).
export const linkCanonicalSchema = z.object({ canonicalId: z.number().int().positive().nullable() })

const recipeIngredient = z.object({
  canonicalId: z.number().int().positive(),
  quantity: qty, // para `servings` porções; a API escala
  optional: z.boolean().default(false), // "sal a gosto": não entra no menor custo
})

export const createRecipeSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').max(80),
    title: z.string().trim().min(1).max(160),
    // SMALLINT > 0; limitado a 100 porções por bom senso (mais estreito que o SQL).
    servings: z.number().int().min(1).max(100).default(4),
    isPublic: z.boolean().default(true),
    ingredients: z.array(recipeIngredient).min(1).max(60),
  })
  .refine((v) => new Set(v.ingredients.map((i) => i.canonicalId)).size === v.ingredients.length, 'Ingrediente repetido.')
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>

// Item da lista: ou um item canônico, ou texto livre ainda não classificado (CHECK list_item_has_target).
const shoppingListItem = z
  .object({
    canonicalId: z.number().int().positive().nullish(),
    freeText: z.string().trim().min(1).max(120).nullish(),
    quantity: qty.default(1),
  })
  .refine((v) => v.canonicalId != null || v.freeText != null, 'Informe canonicalId ou freeText.')

export const createShoppingListSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sourceRecipeId: z.uuid().nullish(),
  // A lista pode nascer vazia (items: []) e ganhar itens depois. Sem .default(): o update reaproveita este
  // campo como opcional, e um default preencheria [] e apagaria os itens num PUT só de título.
  items: z.array(shoppingListItem).max(100),
})
export type CreateShoppingListInput = z.infer<typeof createShoppingListSchema>

// Pedido de otimização: menor custo total (itens + frete de cada loja usada), em até 3 lojas.
export const optimizeCartSchema = z.object({
  items: z
    .array(z.object({ canonicalId: z.number().int().positive(), quantity: qty }))
    .min(1)
    .max(100),
  ...latLng.shape,
  radiusM: z.number().int().min(200).max(10_000).default(3000),
  maxStores: z.number().int().min(1).max(3).default(3),
})
export type OptimizeCartInput = z.infer<typeof optimizeCartSchema>

// Pedido de otimização completo da API: uma fonte entre `items` (avulsos), `listId` (lista do cliente, exige login)
// e `recipeSlug` (+ `servings`). As quantidades viram unidades inteiras (arredonda para cima, máx. 99 por item).
export const optimizeRequestSchema = z
  .object({
    items: optimizeCartSchema.shape.items.optional(),
    listId: z.uuid().optional(),
    recipeSlug: z.string().max(80).optional(),
    servings: z.number().int().min(1).max(100).optional(),
    lat: optimizeCartSchema.shape.lat,
    lng: optimizeCartSchema.shape.lng,
    radiusM: optimizeCartSchema.shape.radiusM,
    maxStores: optimizeCartSchema.shape.maxStores,
  })
  .refine((v) => [v.items, v.listId, v.recipeSlug].filter((x) => x !== undefined).length === 1, 'Informe exatamente um entre items, listId e recipeSlug.')
export type OptimizeRequestInput = z.infer<typeof optimizeRequestSchema>

// Lista a partir de receita: `servings` escala as quantidades (padrão: porções da receita). Ingredientes opcionais ficam de fora.
export const listFromRecipeSchema = z.object({
  recipeSlug: z.string().max(80),
  servings: z.number().int().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(120).optional(),
})

// Troca título e/ou itens da lista (os itens enviados substituem os atuais).
export const updateShoppingListSchema = z
  .object({ title: createShoppingListSchema.shape.title.optional(), items: createShoppingListSchema.shape.items.optional() })
  .refine((v) => v.title !== undefined || v.items !== undefined, 'Nada para alterar.')

export const addListItemSchema = shoppingListItem

export const searchCanonicalSchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

// ---- DTOs de saída ---------------------------------------------------------------------------------

export interface CanonicalProductDTO {
  id: number
  name: string
  categoryId: number | null
  unitKind: UnitKind
  barcode: string | null
  aliases: string[]
}

export interface RecipeDTO {
  id: string
  slug: string
  title: string
  servings: number
  isPublic: boolean
  ingredients: { canonicalId: number; name: string; quantity: number; optional: boolean }[]
}

export interface ShoppingListDTO {
  id: string
  title: string
  sourceRecipeId: string | null
  createdAt: string
  items: { id: string; canonicalId: number | null; canonicalName: string | null; freeText: string | null; quantity: number }[]
}

// Linha do plano: o que comprar, onde e por quanto (preço efetivo, já com Salva-Estoque).
export interface CartPlanLineDTO {
  canonicalId: number
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  subtotal: number
  /** Presente quando o preço é de uma oferta relâmpago ativa (vai ao carrinho como `flash:<id>`). */
  flash?: {
    id: string
    endsAt: string
    maxPerCustomer: number
    qtyAvailable: number
    originalPrice: number
    image: string | null
    unit: string
  }
}

export interface CartPlanStoreDTO {
  merchantId: string
  storeName: string
  neighborhood: string | null
  distanceM: number | null
  /** false = retirada na loja (sem taxa). */
  deliveryEnabled: boolean
  deliveryFee: number
  lines: CartPlanLineDTO[]
  subtotal: number
}

export interface CartPlanDTO {
  stores: CartPlanStoreDTO[]
  itemsTotal: number
  feesTotal: number
  total: number
  /** Itens sem oferta no raio (ficam fora do plano). */
  missing: number[]
}

export interface RecipeSummaryDTO {
  id: string
  slug: string
  title: string
  servings: number
  ingredientCount: number
}

export interface MissingItemDTO {
  canonicalId: number
  name: string
}

/**
 * Resultado do otimizador. `single` = melhor plano comprando numa loja só; `split` = melhor plano em até
 * `maxStores` lojas (pode coincidir com `single`). Como um pedido só aceita uma loja, cada loja do plano vira
 * um carrinho/pedido separado. `missing` = itens sem oferta no raio (fora de qualquer plano).
 */
export interface OptimizeResultDTO {
  single: CartPlanDTO | null
  split: CartPlanDTO | null
  /** Economia de `split` sobre `single` (>= 0; 0 quando coincidem). */
  savings: number
  missing: MissingItemDTO[]
  /** Itens da lista em texto livre, que não entram na comparação. */
  unclassified: string[]
  storesConsidered: number
}
