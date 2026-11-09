import type { Db, DbClient } from '../../shared/db.js'
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './products.schema.js'
import type { MerchantProductDTO } from './products.types.js'

type Queryable = Db | DbClient

// Uma única projeção para vitrine e painel; a rota pública descarta os campos do comerciante.
const PRODUCT_SQL = `
  SELECT p.id, p.user_id AS "merchantId",
         json_build_object('name', u.store_name, 'neighborhood', u.neighborhood, 'city', u.city) AS store,
         json_build_object('id', c.id, 'name', c.name) AS category,
         p.name, p.description, p.unit, p.image,
         p.price::float8 AS price,
         product_effective_price(p.price, p.is_clearance, p.expiration_date)::float8 AS "effectivePrice",
         CASE WHEN p.is_clearance THEN clearance_discount_pct(p.expiration_date) ELSE 0 END AS "discountPct",
         p.is_clearance AS "isClearance",
         p.stock_qty AS "stockQty",
         to_char(p.expiration_date, 'YYYY-MM-DD') AS "expirationDate",
         p.active, p.barcode,
         p.allow_b2b_sharing AS "allowB2bSharing",
         p.b2b_reserve_qty AS "b2bReserveQty",
         p.version,
         to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM products p
    JOIN users u      ON u.id = p.user_id
    JOIN categories c ON c.id = p.category_id`

// Mesma regra da view v_storefront_products: ativo e não vencido.
const SELLABLE = `p.active AND (p.expiration_date IS NULL OR p.expiration_date >= current_date)`

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

export async function listProducts(
  db: Queryable,
  q: Partial<ListProductsQuery> & { ownerId?: string },
): Promise<MerchantProductDTO[]> {
  const params: unknown[] = []
  const where: string[] = []
  const add = (sql: string, value: unknown) => {
    params.push(value)
    const placeholder = `$${params.length}`
    where.push(sql.replaceAll('?', () => placeholder))
  }

  if (q.ownerId) {
    add('p.user_id = ?::uuid', q.ownerId)
    where.push('p.active') // painel: inclui esgotados e vencidos, não os removidos
  } else {
    where.push(SELLABLE)
  }
  if (q.search) add(`(unaccent(p.name) ILIKE unaccent(?) OR unaccent(c.name) ILIKE unaccent(?))`, `%${escapeLike(q.search)}%`)
  if (q.category) add('p.category_id = ?::int', q.category)
  if (q.merchantId) add('p.user_id = ?::uuid', q.merchantId)
  if (q.clearance !== undefined) add('p.is_clearance = ?::boolean', q.clearance)
  if (q.inStock !== undefined) add('(p.stock_qty > 0) = ?::boolean', q.inStock)

  params.push(q.limit ?? 100, q.offset ?? 0)
  const { rows } = await db.query<MerchantProductDTO>(
    `${PRODUCT_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY p.name, p.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function findPublicById(db: Queryable, id: string): Promise<MerchantProductDTO | undefined> {
  const { rows } = await db.query<MerchantProductDTO>(`${PRODUCT_SQL} WHERE p.id = $1 AND ${SELLABLE}`, [id])
  return rows[0]
}

export async function findOwnedById(
  db: Queryable,
  id: string,
  ownerId: string,
  includeInactive = false,
): Promise<MerchantProductDTO | undefined> {
  const { rows } = await db.query<MerchantProductDTO>(
    `${PRODUCT_SQL} WHERE p.id = $1 AND p.user_id = $2 ${includeInactive ? '' : 'AND p.active'}`,
    [id, ownerId],
  )
  return rows[0]
}

export async function insertProduct(db: Queryable, ownerId: string, p: CreateProductInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO products (user_id, category_id, name, description, price, stock_qty, unit, image,
                           expiration_date, allow_b2b_sharing, barcode, b2b_reserve_qty)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [ownerId, p.categoryId, p.name, p.description ?? null, p.price, p.stockQty, p.unit, p.image ?? null,
     p.expirationDate ?? null, p.allowB2bSharing, p.barcode ?? null, p.b2bReserveQty],
  )
  return rows[0]!.id
}

const COLUMNS = {
  name: 'name',
  description: 'description',
  categoryId: 'category_id',
  price: 'price',
  unit: 'unit',
  image: 'image',
  expirationDate: 'expiration_date',
  allowB2bSharing: 'allow_b2b_sharing',
  barcode: 'barcode',
  b2bReserveQty: 'b2b_reserve_qty',
  active: 'active',
} as const

// Atualiza só os campos enviados. Retorna false se o produto não é deste dono (ou foi removido).
// Bloqueio otimista: se o cliente mandar `version`, só grava se ninguém editou o produto antes (senão 'stale' → 409).
export async function updateProduct(db: Queryable, id: string, ownerId: string, patch: UpdateProductInput): Promise<'ok' | 'not_found' | 'stale'> {
  const sets: string[] = ['version = version + 1']
  const params: unknown[] = [id, ownerId]
  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = patch[key as keyof typeof COLUMNS]
    if (value === undefined) continue
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }
  let versionCheck = ''
  if (patch.version !== undefined) {
    params.push(patch.version)
    versionCheck = ` AND version = $${params.length}`
  }
  const { rowCount } = await db.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 AND active${versionCheck}`, params)
  if (rowCount === 1) return 'ok'
  return patch.version !== undefined && (await findOwnedById(db, id, ownerId)) ? 'stale' : 'not_found'
}

export async function softDeleteProduct(db: Queryable, id: string, ownerId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE products SET active = FALSE, allow_b2b_sharing = FALSE WHERE id = $1 AND user_id = $2 AND active`,
    [id, ownerId],
  )
  return rowCount === 1
}

export type StockChange = { delta: number } | { set: number }

// Ajuste atômico: a própria cláusula WHERE impede saldo negativo, sem ler-e-depois-gravar.
// Cada ajuste vira uma linha no livro de estoque (stock_movements) na mesma instrução.
// Retorna 'insufficient' (saída maior que o saldo) ou 'not_found' quando nada foi alterado.
export async function adjustStock(
  db: Queryable,
  id: string,
  ownerId: string,
  change: StockChange,
): Promise<'ok' | 'not_found' | 'insufficient'> {
  const ledger = `INSERT INTO stock_movements (product_id, merchant_id, delta, stock_after, reason)
                  SELECT u.id, u.user_id, u.stock_qty - u.old_qty, u.stock_qty, 'MANUAL_ADJUST' FROM u WHERE u.stock_qty <> u.old_qty`
  const { rowCount } =
    'delta' in change
      ? await db.query(
          `WITH cur AS (SELECT id, stock_qty AS old_qty FROM products WHERE id = $1 AND user_id = $2 FOR UPDATE),
                u AS (UPDATE products p SET stock_qty = p.stock_qty + $3 FROM cur
                       WHERE p.id = cur.id AND p.active AND p.stock_qty + $3 >= 0
                   RETURNING p.id, p.user_id, p.stock_qty, cur.old_qty),
                m AS (${ledger})
           SELECT 1 FROM u`,
          [id, ownerId, change.delta],
        )
      : await db.query(
          `WITH cur AS (SELECT id, stock_qty AS old_qty FROM products WHERE id = $1 AND user_id = $2 FOR UPDATE),
                u AS (UPDATE products p SET stock_qty = $3 FROM cur
                       WHERE p.id = cur.id AND p.active
                   RETURNING p.id, p.user_id, p.stock_qty, cur.old_qty),
                m AS (${ledger})
           SELECT 1 FROM u`,
          [id, ownerId, change.set],
        )
  if (rowCount === 1) return 'ok'
  return (await findOwnedById(db, id, ownerId)) ? 'insufficient' : 'not_found'
}
