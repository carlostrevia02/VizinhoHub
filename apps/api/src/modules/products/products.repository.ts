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
         p.kind, p.lead_time_hours AS "leadTimeHours",
         to_char(p.expiration_date, 'YYYY-MM-DD') AS "expirationDate",
         p.active, p.barcode,
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
    where.push('p.active') // painel: inclui vencidos, não os removidos
  } else {
    where.push(SELLABLE)
  }
  if (q.search) add(`(unaccent(p.name) ILIKE unaccent(?) OR unaccent(c.name) ILIKE unaccent(?))`, `%${escapeLike(q.search)}%`)
  if (q.category) add('p.category_id = ?::int', q.category)
  if (q.merchantId) add('p.user_id = ?::uuid', q.merchantId)
  if (q.clearance !== undefined) add('p.is_clearance = ?::boolean', q.clearance)

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
    `INSERT INTO products (user_id, category_id, name, description, price, unit, image,
                           expiration_date, barcode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [ownerId, p.categoryId, p.name, p.description ?? null, p.price, p.unit, p.image ?? null,
     p.expirationDate ?? null, p.barcode ?? null],
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
  barcode: 'barcode',
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

// Produto removido/desativado não pode continuar "No ar": encerra as ofertas relâmpago ainda vivas dele.
export async function cancelLiveFlashOffers(db: Queryable, productId: string): Promise<void> {
  await db.query(`UPDATE flash_offers SET status = 'CANCELLED' WHERE product_id = $1 AND status IN ('SCHEDULED', 'ACTIVE', 'SOLD_OUT')`, [productId])
}

export async function softDeleteProduct(db: Queryable, id: string, ownerId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE products SET active = FALSE WHERE id = $1 AND user_id = $2 AND active`,
    [id, ownerId],
  )
  return rowCount === 1
}
