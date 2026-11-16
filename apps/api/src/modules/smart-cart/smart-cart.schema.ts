import { z } from 'zod'

export {
  addListItemSchema,
  createCanonicalProductSchema,
  createRecipeSchema,
  createShoppingListSchema,
  linkCanonicalSchema,
  listFromRecipeSchema,
  optimizeRequestSchema,
  searchCanonicalSchema,
  updateShoppingListSchema,
} from '@vizinhohub/contracts/smart-cart'

export const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80) })
export const listParam = z.object({ id: z.uuid() })
export const listItemParam = z.object({ id: z.uuid(), itemId: z.uuid() })
export const productParam = z.object({ productId: z.uuid() })

export const recipesQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const merchantProductsQuery = z.object({
  linked: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
