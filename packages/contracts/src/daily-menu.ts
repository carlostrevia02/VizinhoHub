import { z } from 'zod'
import { isoDate, moneyNonNeg, uuid } from './common.js'

// Módulo 008 · Combos e Prato do Dia (products.kind, combo_items, daily_menu).

export const PRODUCT_KINDS = ['ITEM', 'COMBO', 'DAILY_SPECIAL'] as const
export type ProductKind = (typeof PRODUCT_KINDS)[number]

// ---- Entradas -------------------------------------------------------------------------------------

const comboComponent = z.object({
  componentId: uuid,
  quantity: z.number().int().min(1).max(99).default(1),
})

// Combo = produto kind COMBO composto por outros produtos da mesma loja.
// Vender o combo baixa o estoque dos componentes.
export const createComboSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).nullish(),
    categoryId: z.number().int().positive(),
    price: moneyNonNeg(1_000_000),
    image: z.string().trim().max(255).nullish(),
    components: z.array(comboComponent).min(2, 'Um combo precisa de pelo menos 2 componentes.').max(30),
  })
  .refine((v) => new Set(v.components.map((c) => c.componentId)).size === v.components.length, 'Componente repetido.')
export type CreateComboInput = z.infer<typeof createComboSchema>

// Põe um produto no cardápio de uma data (padrão: hoje). Chave única: (produto, data).
export const setDailyMenuSchema = z
  .object({
    productId: uuid,
    menuDate: isoDate.optional(),
    isOn: z.boolean().default(true),
    qtyTotal: z.number().int().min(0).max(100_000),
  })
export type SetDailyMenuInput = z.infer<typeof setDailyMenuSchema>

// Toggle ON/OFF e/ou novo total do dia (qty_available acompanha na API; nunca passa de qty_total).
export const updateDailyMenuSchema = z
  .object({
    isOn: z.boolean(),
    qtyTotal: z.number().int().min(0).max(100_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')

export const dailyMenuQuerySchema = z.object({
  merchantId: uuid.optional(),
  date: isoDate.optional(),
})

// ---- DTOs de saída ---------------------------------------------------------------------------------

export interface ComboDTO {
  id: string
  merchantId: string
  name: string
  description: string | null
  price: number
  image: string | null
  components: { componentId: string; name: string; quantity: number }[]
  /** Quantos combos dá para montar com o estoque atual dos componentes. */
  available: number
}

export interface DailyMenuItemDTO {
  id: string
  merchantId: string
  productId: string
  productName: string
  price: number
  image: string | null
  menuDate: string // YYYY-MM-DD
  isOn: boolean
  qtyTotal: number
  qtyAvailable: number // <= qtyTotal
  updatedAt: string
}
