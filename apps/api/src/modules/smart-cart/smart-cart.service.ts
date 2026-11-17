import type {
  CanonicalProductDTO,
  CartPlanDTO,
  CartPlanLineDTO,
  CartPlanStoreDTO,
  CreateCanonicalProductInput,
  CreateRecipeInput,
  CreateShoppingListInput,
  OptimizeRequestInput,
  OptimizeResultDTO,
  RecipeDTO,
  RecipeSummaryDTO,
  ShoppingListDTO,
} from '@vizinhohub/contracts/smart-cart'
import { type Db, fromCents, toCents } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import { optimize, type OptimizerOffer, type Plan } from './smart-cart.optimizer.js'
import { vipDiscountPctFor, vipFreeDeliveryMinOrder } from '../vip/vip.discount.js'
import { createSmartCartRepository } from './smart-cart.repository.js'

/** Lojas candidatas ao plano: as mais próximas que vendem pelo menos 1 item (92 combinações no pior caso). */
export const MAX_CANDIDATE_STORES = 8
const MAX_QTY = 99 // limite por item de um pedido (orders)

interface Meta {
  productId: string
  productName: string
  flash?: CartPlanLineDTO['flash']
}

/** Quantidade de uma receita para outro número de porções. Itens em unidade sobem para o inteiro seguinte. */
export function scaleQuantity(quantity: number, recipeServings: number, servings: number, unitKind: 'UN' | 'KG' | 'L' | string): number {
  const q = (quantity * servings) / recipeServings
  return unitKind === 'UN' ? Math.max(1, Math.ceil(q - 1e-9)) : Math.max(0.001, Math.round(q * 1000) / 1000)
}

/** Pedidos aceitam só unidades inteiras: arredonda para cima ("0,3 kg de cebola" vira 1 un. de 1 kg). */
const toUnits = (q: number) => Math.max(1, Math.ceil(q - 1e-9))

export function createSmartCartService(deps: { db: Db }) {
  const { db } = deps
  const repo = createSmartCartRepository(db)

  // ---- itens canônicos ---------------------------------------------------------------------------

  const searchCanonicals = (q: string, limit: number) => repo.searchCanonicals(q, limit)

  async function createCanonical(input: CreateCanonicalProductInput): Promise<CanonicalProductDTO> {
    try {
      return await repo.createCanonical(input)
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError(409, 'CANONICAL_EXISTS', 'Já existe um item canônico com este nome ou código de barras.')
      throw err
    }
  }

  async function linkProduct(merchantId: string, productId: string, canonicalId: number | null) {
    if (canonicalId !== null && (await repo.getCanonicals([canonicalId])).length === 0) throw new AppError(404, 'CANONICAL_NOT_FOUND', 'Item canônico não encontrado.')
    if (!(await repo.linkProduct(merchantId, productId, canonicalId))) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
  }

  const listMerchantProducts = repo.listMerchantProducts

  // ---- receitas ----------------------------------------------------------------------------------

  const listRecipes = (q: string | undefined, limit: number): Promise<RecipeSummaryDTO[]> => repo.listRecipes(q, limit)
  const listMyRecipes = (userId: string, limit: number): Promise<RecipeSummaryDTO[]> => repo.listRecipes(undefined, limit, userId)

  async function getRecipe(slug: string): Promise<RecipeDTO> {
    const r = await repo.getRecipeBySlug(slug)
    if (!r) throw new AppError(404, 'RECIPE_NOT_FOUND', 'Receita não encontrada.')
    return r
  }

  async function createRecipe(userId: string, input: CreateRecipeInput): Promise<RecipeDTO> {
    const found = await repo.getCanonicals(input.ingredients.map((i) => i.canonicalId))
    if (found.length !== input.ingredients.length) throw new AppError(422, 'CANONICAL_NOT_FOUND', 'Algum ingrediente não existe como item canônico.')
    try {
      await repo.createRecipe(userId, input)
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError(409, 'RECIPE_SLUG_TAKEN', 'Já existe uma receita com este endereço (slug).')
      throw err
    }
    // Receita privada não sai por /recipes/:slug; devolve o que acabou de ser criado.
    return {
      id: '',
      slug: input.slug,
      title: input.title,
      servings: input.servings,
      isPublic: input.isPublic,
      ingredients: input.ingredients.map((i) => ({ canonicalId: i.canonicalId, name: found.find((c) => c.id === i.canonicalId)!.name, quantity: i.quantity, optional: i.optional })),
    }
  }

  // ---- listas ------------------------------------------------------------------------------------

  const listLists = (userId: string) => repo.listLists(userId)

  async function getList(userId: string, id: string): Promise<ShoppingListDTO> {
    const l = await repo.getList(userId, id)
    if (!l) throw new AppError(404, 'LIST_NOT_FOUND', 'Lista não encontrada.')
    return l
  }

  async function assertCanonicals(items: { canonicalId?: number | null }[]) {
    const ids = [...new Set(items.map((i) => i.canonicalId).filter((x): x is number => x != null))]
    if ((await repo.getCanonicals(ids)).length !== ids.length) throw new AppError(422, 'CANONICAL_NOT_FOUND', 'Algum item canônico não existe.')
  }

  async function createList(userId: string, input: CreateShoppingListInput): Promise<ShoppingListDTO> {
    await assertCanonicals(input.items)
    if (input.sourceRecipeId) {
      const { rows } = await db.query(`SELECT 1 FROM recipes WHERE id = $1 AND (is_public OR author_id = $2)`, [input.sourceRecipeId, userId])
      if (rows.length === 0) throw new AppError(404, 'RECIPE_NOT_FOUND', 'Receita não encontrada.')
    }
    const id = await repo.createList(userId, input)
    return getList(userId, id)
  }

  async function updateList(userId: string, id: string, patch: { title?: string; items?: CreateShoppingListInput['items'] }): Promise<ShoppingListDTO> {
    if (patch.items) await assertCanonicals(patch.items)
    if (!(await repo.updateList(userId, id, patch))) throw new AppError(404, 'LIST_NOT_FOUND', 'Lista não encontrada.')
    return getList(userId, id)
  }

  async function deleteList(userId: string, id: string) {
    if (!(await repo.deleteList(userId, id))) throw new AppError(404, 'LIST_NOT_FOUND', 'Lista não encontrada.')
  }

  async function addListItem(userId: string, listId: string, item: CreateShoppingListInput['items'][number]): Promise<ShoppingListDTO> {
    await assertCanonicals([item])
    const list = await getList(userId, listId)
    if (list.items.length >= 100) throw new AppError(422, 'LIST_FULL', 'A lista pode ter no máximo 100 itens.')
    await repo.addListItem(userId, listId, item)
    return getList(userId, listId)
  }

  async function removeListItem(userId: string, listId: string, itemId: string) {
    if (!(await repo.removeListItem(userId, listId, itemId))) throw new AppError(404, 'LIST_ITEM_NOT_FOUND', 'Item não encontrado.')
  }

  /** Cria a lista de compras de uma receita nas porções pedidas (ingredientes opcionais ficam de fora). */
  async function createListFromRecipe(userId: string, input: { recipeSlug: string; servings?: number; title?: string }): Promise<ShoppingListDTO> {
    const recipe = await getRecipe(input.recipeSlug)
    const servings = input.servings ?? recipe.servings
    const kinds = await unitKinds(recipe.ingredients.map((i) => i.canonicalId))
    const items = recipe.ingredients
      .filter((i) => !i.optional)
      .map((i) => ({ canonicalId: i.canonicalId, quantity: scaleQuantity(i.quantity, recipe.servings, servings, kinds.get(i.canonicalId) ?? 'UN') }))
    const id = await repo.createList(userId, { title: input.title ?? `${recipe.title} (${servings} porções)`.slice(0, 120), sourceRecipeId: recipe.id, items })
    return getList(userId, id)
  }

  async function unitKinds(ids: number[]) {
    const rows = await repo.getCanonicals(ids)
    return new Map(rows.map((c) => [c.id, c.unitKind]))
  }

  // ---- otimizador --------------------------------------------------------------------------------

  /** Junta a fonte do pedido (itens avulsos, lista ou receita) numa lista de { item canônico, unidades }. */
  async function resolveSource(userId: string | undefined, req: OptimizeRequestInput) {
    const unclassified: string[] = []
    const qty = new Map<number, number>()
    const add = (id: number, q: number) => qty.set(id, (qty.get(id) ?? 0) + q)

    if (req.items) {
      for (const i of req.items) add(i.canonicalId, i.quantity)
    } else if (req.listId) {
      if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para usar uma lista.')
      const list = await getList(userId, req.listId)
      for (const i of list.items) {
        if (i.canonicalId != null) add(i.canonicalId, i.quantity)
        else if (i.freeText) unclassified.push(i.freeText)
      }
    } else if (req.recipeSlug) {
      const recipe = await getRecipe(req.recipeSlug)
      const servings = req.servings ?? recipe.servings
      const kinds = await unitKinds(recipe.ingredients.map((i) => i.canonicalId))
      for (const i of recipe.ingredients) if (!i.optional) add(i.canonicalId, scaleQuantity(i.quantity, recipe.servings, servings, kinds.get(i.canonicalId) ?? 'UN'))
    }
    if (qty.size === 0) throw new AppError(422, 'NOTHING_TO_OPTIMIZE', 'Não há itens canônicos para comparar.')
    const items = [...qty].map(([canonicalId, q]) => ({ canonicalId, quantity: toUnits(q) }))
    if (items.some((i) => i.quantity > MAX_QTY)) throw new AppError(422, 'QUANTITY_TOO_LARGE', `Máximo de ${MAX_QTY} unidades por item.`)
    return { items, unclassified }
  }

  async function optimizeCart(userId: string | undefined, req: OptimizeRequestInput): Promise<OptimizeResultDTO> {
    const { items, unclassified } = await resolveSource(userId, req)
    const ids = items.map((i) => i.canonicalId)
    const names = new Map((await repo.getCanonicals(ids)).map((c) => [c.id, c.name]))
    if (names.size !== new Set(ids).size) throw new AppError(422, 'CANONICAL_NOT_FOUND', 'Algum item canônico não existe.')

    const [offerRows, flashRows] = await Promise.all([repo.findOffers(ids, req.lat, req.lng, req.radiusM), repo.findFlashOffers(ids, req.lat, req.lng)])

    // Lojas candidatas: as mais próximas com pelo menos 1 oferta.
    const storeInfo = new Map<string, { merchantId: string; storeName: string; neighborhood: string | null; distanceM: number }>()
    for (const o of offerRows) if (!storeInfo.has(o.merchantId)) storeInfo.set(o.merchantId, o)
    const candidates = [...storeInfo.values()].sort((a, b) => a.distanceM - b.distanceM || a.merchantId.localeCompare(b.merchantId)).slice(0, MAX_CANDIDATE_STORES)
    const delivery = new Map((await repo.findDelivery(candidates.map((s) => s.merchantId))).map((d) => [d.merchantId, d]))
    // Sem entrega para este endereço (desligada ou fora do raio) = retirada na loja, sem taxa.
    const delivers = (s: (typeof candidates)[number]) => {
      const d = delivery.get(s.merchantId)
      return d !== undefined && d.enabled && s.distanceM <= d.radiusM
    }
    const feeCents = (s: (typeof candidates)[number]) => (delivers(s) ? toCents(delivery.get(s.merchantId)!.fee) : 0)

    // Clube VIP: só com login. Percentual e mínimo do frete grátis por loja candidata (até 8 consultas pequenas).
    const vip = new Map<string, { pct: number; freeMinCents: number | null }>()
    if (userId) {
      await Promise.all(
        candidates.map(async (s) => {
          const [pct, min] = await Promise.all([vipDiscountPctFor(db, userId, s.merchantId), vipFreeDeliveryMinOrder(db, userId, s.merchantId)])
          vip.set(s.merchantId, { pct, freeMinCents: min === null ? null : toCents(min.toFixed(2)) })
        }),
      )
    }

    const qty = new Map(items.map((i) => [i.canonicalId, i.quantity]))
    const offers: OptimizerOffer<Meta>[] = []
    for (const o of offerRows) {
      offers.push({ merchantId: o.merchantId, canonicalId: o.canonicalId, priceCents: toCents(o.price), available: o.stock, flash: false, meta: { productId: o.productId, productName: o.productName } })
    }
    // Oferta relâmpago entra como mais uma opção da loja: só vence se for mais barata e tiver saldo/limite para a quantidade.
    for (const f of flashRows) {
      if (!qty.has(f.canonicalId)) continue
      offers.push({
        merchantId: f.merchantId,
        canonicalId: f.canonicalId,
        priceCents: toCents(f.offerPrice),
        available: Math.min(f.qtyAvailable, f.maxPerCustomer),
        flash: true,
        meta: {
          productId: f.productId,
          productName: f.productName,
          flash: { id: f.flashId, endsAt: f.endsAt, maxPerCustomer: f.maxPerCustomer, qtyAvailable: f.qtyAvailable, originalPrice: Number(f.originalPrice), image: f.image, unit: f.unit },
        },
      })
    }

    const out = optimize<Meta>({
      items,
      stores: candidates.map((s) => ({ merchantId: s.merchantId, feeCents: feeCents(s), vipPct: vip.get(s.merchantId)?.pct ?? 0, vipFreeMinCents: vip.get(s.merchantId)?.freeMinCents ?? null })),
      offers,
      maxStores: req.maxStores,
    })

    const toDto = (plan: Plan<Meta> | null): CartPlanDTO | null => {
      if (!plan) return null
      const stores: CartPlanStoreDTO[] = plan.stores.map((ps) => {
        const mid = ps.merchantId
        const s = storeInfo.get(mid)!
        const lines: CartPlanLineDTO[] = plan.lines
          .filter((l) => l.merchantId === mid)
          .map((l) => ({
            canonicalId: l.canonicalId,
            productId: l.meta!.productId,
            productName: l.meta!.productName,
            quantity: l.quantity,
            unitPrice: fromCents(l.unitCents),
            subtotal: fromCents(l.subtotalCents),
            ...(l.listUnitCents !== l.unitCents && { originalUnitPrice: fromCents(l.listUnitCents) }),
            ...(l.meta!.flash && { flash: l.meta!.flash }),
          }))
        return {
          merchantId: mid,
          storeName: s.storeName,
          neighborhood: s.neighborhood,
          distanceM: s.distanceM,
          deliveryEnabled: delivers(s),
          deliveryFee: fromCents(ps.feeCents),
          ...(ps.freeDeliveryVip && { originalDeliveryFee: fromCents(ps.baseFeeCents) }),
          lines,
          subtotal: fromCents(ps.itemsCents),
          vipDiscountPct: ps.vipPct,
          vipSavings: fromCents(ps.vipSavingsCents),
          vipFreeDelivery: ps.freeDeliveryVip,
        }
      })
      return { stores, itemsTotal: fromCents(plan.itemsCents), feesTotal: fromCents(plan.feesCents), total: fromCents(plan.totalCents), vipSavings: fromCents(plan.vipSavingsCents), missing: plan.missing }
    }

    const single = toDto(out.single)
    const split = toDto(out.split)
    // `split` só difere de `single` quando divide de fato E cobre pelo menos o mesmo ou custa menos.
    const savings = single && split ? Math.max(0, fromCents(toCents(single.total) - toCents(split.total))) : 0
    return {
      single,
      split,
      savings,
      missing: out.unavailable.map((canonicalId) => ({ canonicalId, name: names.get(canonicalId)! })),
      unclassified,
      storesConsidered: candidates.length,
    }
  }

  return {
    searchCanonicals,
    createCanonical,
    linkProduct,
    listMerchantProducts,
    listRecipes,
    listMyRecipes,
    getRecipe,
    createRecipe,
    listLists,
    getList,
    createList,
    updateList,
    deleteList,
    addListItem,
    removeListItem,
    createListFromRecipe,
    optimizeCart,
  }
}

export type SmartCartService = ReturnType<typeof createSmartCartService>
