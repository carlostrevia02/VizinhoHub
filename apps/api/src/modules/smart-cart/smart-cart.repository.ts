import type { CanonicalProductDTO, CreateCanonicalProductInput, CreateRecipeInput, RecipeDTO, RecipeSummaryDTO, ShoppingListDTO } from '@vizinhohub/contracts/smart-cart'
import { type Db, withTransaction } from '../../shared/db.js'

type Q = Pick<Db, 'query'>

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

export interface OfferRow {
  canonicalId: number
  productId: string
  merchantId: string
  productName: string
  stock: number
  price: string
  storeName: string
  neighborhood: string | null
  distanceM: number
}

export interface FlashRow {
  canonicalId: number
  flashId: string
  merchantId: string
  productId: string
  productName: string
  offerPrice: string
  originalPrice: string
  qtyAvailable: number
  maxPerCustomer: number
  endsAt: string
  image: string | null
  unit: string
}

export interface DeliveryRow {
  merchantId: string
  enabled: boolean
  radiusM: number
  fee: string
}

const canonicalCols = `id, name, category_id AS "categoryId", unit_kind AS "unitKind", barcode, aliases`

export function createSmartCartRepository(db: Db) {
  // ---- itens canônicos ---------------------------------------------------------------------------

  async function searchCanonicals(q: string, limit: number): Promise<CanonicalProductDTO[]> {
    const { rows } = await db.query<CanonicalProductDTO>(
      `SELECT ${canonicalCols}
         FROM canonical_products
        WHERE unaccent(name) ILIKE unaccent($1) OR unaccent(array_to_string(aliases, ' ')) ILIKE unaccent($1)
        ORDER BY (unaccent(name) ILIKE unaccent($2)) DESC, name LIMIT $3`,
      [`%${escapeLike(q)}%`, `${escapeLike(q)}%`, limit],
    )
    return rows
  }

  async function getCanonicals(ids: number[], q: Q = db): Promise<CanonicalProductDTO[]> {
    if (ids.length === 0) return []
    const { rows } = await q.query<CanonicalProductDTO>(`SELECT ${canonicalCols} FROM canonical_products WHERE id = ANY($1::int[])`, [ids])
    return rows
  }

  async function createCanonical(input: CreateCanonicalProductInput): Promise<CanonicalProductDTO> {
    const { rows } = await db.query<CanonicalProductDTO>(
      `INSERT INTO canonical_products (name, category_id, unit_kind, barcode, aliases) VALUES ($1, $2, $3, $4, $5) RETURNING ${canonicalCols}`,
      [input.name, input.categoryId ?? null, input.unitKind, input.barcode ?? null, input.aliases],
    )
    return rows[0]!
  }

  /** Vincula (ou desvincula) um produto do lojista. Devolve false se o produto não é dele. */
  async function linkProduct(merchantId: string, productId: string, canonicalId: number | null): Promise<boolean> {
    const { rowCount } = await db.query(`UPDATE products SET canonical_id = $3 WHERE id = $1 AND user_id = $2`, [productId, merchantId, canonicalId])
    return (rowCount ?? 0) > 0
  }

  async function listMerchantProducts(merchantId: string, opts: { linked?: boolean; q?: string; limit: number; offset: number }) {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.price::float8 AS price, p.canonical_id AS "canonicalId", c.name AS "canonicalName"
         FROM products p LEFT JOIN canonical_products c ON c.id = p.canonical_id
        WHERE p.user_id = $1 AND p.active
          AND ($2::boolean IS NULL OR (p.canonical_id IS NOT NULL) = $2)
          AND ($3::text IS NULL OR unaccent(p.name) ILIKE unaccent($3))
        ORDER BY p.name LIMIT $4 OFFSET $5`,
      [merchantId, opts.linked ?? null, opts.q ? `%${escapeLike(opts.q)}%` : null, opts.limit, opts.offset],
    )
    return rows
  }

  // ---- receitas ----------------------------------------------------------------------------------

  async function listRecipes(q: string | undefined, limit: number, authorId?: string): Promise<RecipeSummaryDTO[]> {
    const { rows } = await db.query<RecipeSummaryDTO>(
      `SELECT r.id, r.slug, r.title, r.servings, (SELECT count(*)::int FROM recipe_ingredients i WHERE i.recipe_id = r.id) AS "ingredientCount"
         FROM recipes r
        WHERE ($3::uuid IS NULL AND r.is_public OR r.author_id = $3::uuid)
          AND ($1::text IS NULL OR unaccent(r.title) ILIKE unaccent($1))
        ORDER BY r.title LIMIT $2`,
      [q ? `%${escapeLike(q)}%` : null, limit, authorId ?? null],
    )
    return rows
  }

  async function getRecipeBySlug(slug: string): Promise<RecipeDTO | null> {
    const { rows } = await db.query<Omit<RecipeDTO, 'ingredients'> & { ingredients: RecipeDTO['ingredients'] }>(
      `SELECT r.id, r.slug, r.title, r.servings, r.is_public AS "isPublic",
              COALESCE((SELECT json_agg(json_build_object('canonicalId', i.canonical_id, 'name', c.name, 'quantity', i.quantity::float8, 'optional', i.optional)
                                        ORDER BY i.optional, c.name)
                          FROM recipe_ingredients i JOIN canonical_products c ON c.id = i.canonical_id WHERE i.recipe_id = r.id), '[]'::json) AS ingredients
         FROM recipes r WHERE r.slug = $1 AND r.is_public`,
      [slug],
    )
    return rows[0] ?? null
  }

  async function createRecipe(authorId: string, input: CreateRecipeInput): Promise<string> {
    return withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO recipes (slug, title, servings, author_id, is_public) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.slug, input.title, input.servings, authorId, input.isPublic],
      )
      const id = rows[0]!.id
      for (const i of input.ingredients) {
        await tx.query(`INSERT INTO recipe_ingredients (recipe_id, canonical_id, quantity, optional) VALUES ($1, $2, $3, $4)`, [id, i.canonicalId, i.quantity, i.optional])
      }
      return id
    })
  }

  // ---- listas de compras -------------------------------------------------------------------------

  const listSelect = `
    SELECT l.id, l.title, l.source_recipe_id AS "sourceRecipeId", ${iso('l.created_at')} AS "createdAt",
           COALESCE((SELECT json_agg(json_build_object('id', i.id, 'canonicalId', i.canonical_id, 'canonicalName', c.name, 'freeText', i.free_text, 'quantity', i.quantity::float8)
                                     ORDER BY i.id)
                       FROM shopping_list_items i LEFT JOIN canonical_products c ON c.id = i.canonical_id WHERE i.list_id = l.id), '[]'::json) AS items
      FROM shopping_lists l`

  async function listLists(userId: string): Promise<ShoppingListDTO[]> {
    const { rows } = await db.query<ShoppingListDTO>(`${listSelect} WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 100`, [userId])
    return rows
  }

  async function getList(userId: string, id: string, q: Q = db): Promise<ShoppingListDTO | null> {
    const { rows } = await q.query<ShoppingListDTO>(`${listSelect} WHERE l.id = $1 AND l.user_id = $2`, [id, userId])
    return rows[0] ?? null
  }

  type ItemInput = { canonicalId?: number | null; freeText?: string | null; quantity: number }

  async function insertItems(tx: Q, listId: string, items: ItemInput[]) {
    for (const i of items) {
      await tx.query(`INSERT INTO shopping_list_items (list_id, canonical_id, free_text, quantity) VALUES ($1, $2, $3, $4)`, [
        listId,
        i.canonicalId ?? null,
        i.canonicalId != null ? null : (i.freeText ?? null),
        i.quantity,
      ])
    }
  }

  async function createList(userId: string, input: { title: string; sourceRecipeId?: string | null; items: ItemInput[] }): Promise<string> {
    return withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(`INSERT INTO shopping_lists (user_id, title, source_recipe_id) VALUES ($1, $2, $3) RETURNING id`, [
        userId,
        input.title,
        input.sourceRecipeId ?? null,
      ])
      await insertItems(tx, rows[0]!.id, input.items)
      return rows[0]!.id
    })
  }

  /** Atualiza título e/ou troca todos os itens. false = a lista não existe ou não é do usuário. */
  async function updateList(userId: string, id: string, patch: { title?: string; items?: ItemInput[] }): Promise<boolean> {
    return withTransaction(db, async (tx) => {
      const { rows } = await tx.query(`SELECT 1 FROM shopping_lists WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId])
      if (rows.length === 0) return false
      if (patch.title !== undefined) await tx.query(`UPDATE shopping_lists SET title = $2 WHERE id = $1`, [id, patch.title])
      if (patch.items !== undefined) {
        await tx.query(`DELETE FROM shopping_list_items WHERE list_id = $1`, [id])
        await insertItems(tx, id, patch.items)
      }
      return true
    })
  }

  async function deleteList(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await db.query(`DELETE FROM shopping_lists WHERE id = $1 AND user_id = $2`, [id, userId])
    return (rowCount ?? 0) > 0
  }

  async function addListItem(userId: string, listId: string, item: ItemInput): Promise<boolean> {
    return withTransaction(db, async (tx) => {
      const { rows } = await tx.query(`SELECT 1 FROM shopping_lists WHERE id = $1 AND user_id = $2 FOR UPDATE`, [listId, userId])
      if (rows.length === 0) return false
      await insertItems(tx, listId, [item])
      return true
    })
  }

  async function removeListItem(userId: string, listId: string, itemId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `DELETE FROM shopping_list_items i USING shopping_lists l WHERE i.id = $1 AND i.list_id = $2 AND l.id = i.list_id AND l.user_id = $3`,
      [itemId, listId, userId],
    )
    return (rowCount ?? 0) > 0
  }

  async function countListItems(listId: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM shopping_list_items WHERE list_id = $1`, [listId])
    return rows[0]!.n
  }

  // ---- ofertas para o otimizador -------------------------------------------------------------------

  async function findOffers(canonicalIds: number[], lat: number, lng: number, radiusM: number): Promise<OfferRow[]> {
    const { rows } = await db.query<OfferRow>(
      `SELECT * FROM (
         SELECT o.canonical_id AS "canonicalId", o.product_id AS "productId", o.merchant_id AS "merchantId", o.product_name AS "productName",
                o.stock_qty AS stock, o.effective_price::text AS price, o.store_name AS "storeName", o.neighborhood,
                distance_m(o.store_lat, o.store_lng, $2::float8, $3::float8)::int AS "distanceM"
           FROM v_canonical_offers o
          WHERE o.canonical_id = ANY($1::int[]) AND o.store_lat IS NOT NULL AND o.store_lng IS NOT NULL) x
        WHERE x."distanceM" <= $4`,
      [canonicalIds, lat, lng, radiusM],
    )
    return rows
  }

  /** Ofertas relâmpago vivas dos itens canônicos, que alcançam (lat, lng) pelo próprio raio da oferta. */
  async function findFlashOffers(canonicalIds: number[], lat: number, lng: number): Promise<FlashRow[]> {
    const { rows } = await db.query<FlashRow>(
      `SELECT * FROM (
         SELECT p.canonical_id AS "canonicalId", f.id AS "flashId", f.merchant_id AS "merchantId", f.product_id AS "productId", f.product_name AS "productName",
                f.offer_price::text AS "offerPrice", f.original_price::text AS "originalPrice", f.qty_available AS "qtyAvailable",
                f.max_per_customer AS "maxPerCustomer", ${iso('f.ends_at')} AS "endsAt", f.image, f.unit,
                distance_m(f.store_lat, f.store_lng, $2::float8, $3::float8) AS dist, f.radius_m
           FROM v_flash_offers_live f JOIN products p ON p.id = f.product_id
          WHERE p.canonical_id = ANY($1::int[])) x
        WHERE x.dist <= x.radius_m`,
      [canonicalIds, lat, lng],
    )
    return rows.map((r) => {
      const { dist: _d, radius_m: _r, ...rest } = r as FlashRow & { dist: number; radius_m: number }
      return rest
    })
  }

  async function findDelivery(merchantIds: string[]): Promise<DeliveryRow[]> {
    if (merchantIds.length === 0) return []
    const { rows } = await db.query<DeliveryRow>(
      `SELECT merchant_id AS "merchantId", delivery_enabled AS enabled, delivery_radius_m AS "radiusM", delivery_fee::text AS fee
         FROM store_delivery_config WHERE merchant_id = ANY($1::uuid[])`,
      [merchantIds],
    )
    return rows
  }

  return {
    searchCanonicals,
    getCanonicals,
    createCanonical,
    linkProduct,
    listMerchantProducts,
    listRecipes,
    getRecipeBySlug,
    createRecipe,
    listLists,
    getList,
    createList,
    updateList,
    deleteList,
    addListItem,
    removeListItem,
    countListItems,
    findOffers,
    findFlashOffers,
    findDelivery,
  }
}

export type SmartCartRepository = ReturnType<typeof createSmartCartRepository>

/** Escapa % _ \ para uso em ILIKE. */
function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}
