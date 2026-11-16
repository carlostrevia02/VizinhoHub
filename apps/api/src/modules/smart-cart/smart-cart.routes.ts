import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import {
  addListItemSchema,
  createCanonicalProductSchema,
  createRecipeSchema,
  createShoppingListSchema,
  linkCanonicalSchema,
  listFromRecipeSchema,
  listItemParam,
  listParam,
  merchantProductsQuery,
  optimizeRequestSchema,
  productParam,
  recipesQuery,
  searchCanonicalSchema,
  slugParam,
  updateShoppingListSchema,
} from './smart-cart.schema.js'
import type { SmartCartService } from './smart-cart.service.js'

// Carrinho Inteligente: itens canônicos, receitas, listas de compras e otimizador de lojas.
export function smartCartRouter(service: SmartCartService, requireLogin: RequestHandler) {
  const router = Router()
  // Login opcional: com token valida e carrega o usuário; sem token segue anônimo.
  const optionalLogin: RequestHandler = (req, res, next) => (req.headers.authorization ? requireLogin(req, res, next) : next())

  // ---- itens canônicos ----
  router.get('/canonicals', async (req, res) => {
    const q = searchCanonicalSchema.parse(req.query)
    res.json(await service.searchCanonicals(q.q, q.limit))
  })
  router.post('/canonicals', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.status(201).json(await service.createCanonical(createCanonicalProductSchema.parse(req.body)))
  })
  // Produtos do lojista (para vincular): ?linked=false lista os ainda sem item canônico.
  router.get('/my-products', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.json(await service.listMerchantProducts(req.user!.id, merchantProductsQuery.parse(req.query)))
  })
  router.put('/products/:productId/canonical', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    await service.linkProduct(req.user!.id, productParam.parse(req.params).productId, linkCanonicalSchema.parse(req.body).canonicalId)
    res.status(204).end()
  })

  // ---- receitas ----
  router.get('/recipes', async (req, res) => {
    const q = recipesQuery.parse(req.query)
    res.json(await service.listRecipes(q.q, q.limit))
  })
  router.get('/recipes/mine', requireLogin, async (req, res) => {
    res.json(await service.listMyRecipes(req.user!.id, recipesQuery.parse(req.query).limit))
  })
  router.get('/recipes/:slug', async (req, res) => {
    res.json(await service.getRecipe(slugParam.parse(req.params).slug))
  })
  router.post('/recipes', requireLogin, async (req, res) => {
    res.status(201).json(await service.createRecipe(req.user!.id, createRecipeSchema.parse(req.body)))
  })

  // ---- listas de compras (do usuário logado) ----
  router.get('/lists', requireLogin, async (req, res) => res.json(await service.listLists(req.user!.id)))
  router.post('/lists', requireLogin, async (req, res) => {
    res.status(201).json(await service.createList(req.user!.id, createShoppingListSchema.parse(req.body)))
  })
  router.post('/lists/from-recipe', requireLogin, async (req, res) => {
    res.status(201).json(await service.createListFromRecipe(req.user!.id, listFromRecipeSchema.parse(req.body)))
  })
  router.get('/lists/:id', requireLogin, async (req, res) => {
    res.json(await service.getList(req.user!.id, listParam.parse(req.params).id))
  })
  router.put('/lists/:id', requireLogin, async (req, res) => {
    res.json(await service.updateList(req.user!.id, listParam.parse(req.params).id, updateShoppingListSchema.parse(req.body)))
  })
  router.delete('/lists/:id', requireLogin, async (req, res) => {
    await service.deleteList(req.user!.id, listParam.parse(req.params).id)
    res.status(204).end()
  })
  router.post('/lists/:id/items', requireLogin, async (req, res) => {
    res.status(201).json(await service.addListItem(req.user!.id, listParam.parse(req.params).id, addListItemSchema.parse(req.body)))
  })
  router.delete('/lists/:id/items/:itemId', requireLogin, async (req, res) => {
    const p = listItemParam.parse(req.params)
    await service.removeListItem(req.user!.id, p.id, p.itemId)
    res.status(204).end()
  })

  // ---- otimizador: público para itens avulsos/receita; `listId` exige login ----
  router.post('/optimize', optionalLogin, async (req, res) => {
    res.json(await service.optimizeCart(req.user?.id, optimizeRequestSchema.parse(req.body)))
  })

  return router
}
