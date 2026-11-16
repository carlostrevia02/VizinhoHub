import type { Db, DbClient } from '../../shared/db.js'
import type { ListOrdersQuery } from './orders.schema.js'
import type { OrderDTO, OrderStatus } from './orders.types.js'

type Queryable = Db | DbClient

export interface ProductForOrder {
  id: string
  merchant_id: string
  name: string
  stock_qty: number
  sellable: boolean // ativo e não vencido
  unit_price: string // preço efetivo (com desconto Salva-Estoque), NUMERIC como string
}

// Preço calculado no banco pela mesma função da vitrine: o cliente nunca informa preço.
export async function findProductsForOrder(db: Queryable, ids: string[]): Promise<ProductForOrder[]> {
  const { rows } = await db.query<ProductForOrder>(
    // product_available: combo = o que os componentes permitem; prato do dia = porções de hoje (migração 012).
    `SELECT p.id, p.user_id AS merchant_id, p.name, product_available(p.id, p.kind, p.stock_qty) AS stock_qty,
            (p.active AND (p.expiration_date IS NULL OR p.expiration_date >= current_date)) AS sellable,
            product_effective_price(p.price, p.is_clearance, p.expiration_date)::text AS unit_price
       FROM products p
      WHERE p.id = ANY($1::uuid[])`,
    [ids],
  )
  return rows
}

export async function insertOrder(
  db: Queryable,
  order: {
    customerId: string | null
    merchantId: string
    totalPrice: string
    channel?: 'ONLINE' | 'POS'
    status?: OrderStatus
    contact?: { name?: string; phone?: string; deliveryMethod?: string; deliveryAddress?: string; paymentMethod?: string; notes?: string }
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO orders (customer_id, merchant_id, total_price, channel, status, contact_name, phone, delivery_method, delivery_address, payment_method, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      order.customerId,
      order.merchantId,
      order.totalPrice,
      order.channel ?? 'ONLINE',
      order.status ?? 'PENDING',
      order.contact?.name ?? null,
      order.contact?.phone ?? null,
      order.contact?.deliveryMethod ?? null,
      order.contact?.deliveryAddress ?? null,
      order.contact?.paymentMethod ?? null,
      order.contact?.notes ?? null,
    ],
  )
  return rows[0]!.id
}

export async function insertOrderItems(
  db: Queryable,
  orderId: string,
  items: { productId: string; quantity: number; unitPrice: string; flashOfferId?: string | null }[],
): Promise<void> {
  await db.query(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price, flash_offer_id)
     SELECT $1, product_id, quantity, unit_price, flash_offer_id
       FROM unnest($2::uuid[], $3::int[], $4::numeric[], $5::uuid[]) AS t(product_id, quantity, unit_price, flash_offer_id)`,
    [orderId, items.map((i) => i.productId), items.map((i) => i.quantity), items.map((i) => i.unitPrice), items.map((i) => i.flashOfferId ?? null)],
  )
}

// Monta o OrderDTO (pedido + cliente + itens) numa única consulta.
const ORDER_DTO_SQL = `
  SELECT o.id,
         o.merchant_id                     AS "merchantId",
         CASE WHEN c.id IS NULL THEN NULL
              ELSE json_build_object('id', c.id, 'name', c.name) END AS customer,
         json_build_object('name', o.contact_name, 'phone', o.phone,
                           'deliveryMethod', o.delivery_method, 'deliveryAddress', o.delivery_address,
                           'paymentMethod', o.payment_method, 'notes', o.notes) AS contact,
         o.channel,
         o.status,
         o.total_price::float8             AS "totalPrice",
         o.vip_savings::float8             AS "vipSavings",
         to_char(o.scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "scheduledFor",
         o.slot_id                         AS "slotId",
         o.deposit_amount::float8          AS "depositAmount",
         to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
         to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
         (SELECT json_agg(json_build_object(
                   'productId', oi.product_id, 'name', p.name,
                   'quantity', oi.quantity, 'unitPrice', oi.unit_price::float8, 'flashOfferId', oi.flash_offer_id) ORDER BY p.name)
            FROM order_items oi JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id)        AS items
    FROM orders o
    LEFT JOIN users c ON c.id = o.customer_id`

export async function findOrderById(db: Queryable, id: string): Promise<OrderDTO | undefined> {
  const { rows } = await db.query<OrderDTO>(`${ORDER_DTO_SQL} WHERE o.id = $1`, [id])
  return rows[0]
}

export async function listOrders(
  db: Queryable,
  filter: { merchantId?: string; customerId?: string } & Partial<Pick<ListOrdersQuery, 'status' | 'channel' | 'active' | 'limit'>>,
): Promise<OrderDTO[]> {
  const { rows } = await db.query<OrderDTO>(
    `${ORDER_DTO_SQL}
      WHERE ($1::uuid IS NULL OR o.merchant_id = $1)
        AND ($2::uuid IS NULL OR o.customer_id = $2)
        AND ($3::order_status IS NULL OR o.status = $3)
        AND ($4::boolean IS NULL OR (o.status NOT IN ('COMPLETED', 'CANCELLED')) = $4)
        AND ($5::order_channel IS NULL OR o.channel = $5)
      ORDER BY o.created_at DESC
      LIMIT $6`,
    [
      filter.merchantId ?? null,
      filter.customerId ?? null,
      filter.status ?? null,
      filter.active ?? null,
      filter.channel ?? null,
      filter.limit ?? 100,
    ],
  )
  return rows
}

// ---- transição de status -------------------------------------------------------

export interface LockedOrder {
  id: string
  merchant_id: string
  customer_id: string | null
  status: OrderStatus
}

// FOR UPDATE: duas mudanças de status simultâneas no mesmo pedido se enfileiram (a 2ª vê o status novo).
export async function lockOrder(db: DbClient, id: string): Promise<LockedOrder | undefined> {
  const { rows } = await db.query<LockedOrder>(
    `SELECT id, merchant_id, customer_id, status FROM orders WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return rows[0]
}

export async function setStatus(db: DbClient, id: string, status: OrderStatus): Promise<void> {
  await db.query(`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`, [id, status])
}

// Linhas do pedido que vieram de ofertas relâmpago (para devolver o saldo ao cancelar).
export async function listOrderFlashLines(db: Queryable, orderId: string): Promise<{ flashOfferId: string; quantity: number }[]> {
  const { rows } = await db.query<{ flash_offer_id: string; quantity: number }>(
    `SELECT flash_offer_id, quantity FROM order_items WHERE order_id = $1 AND flash_offer_id IS NOT NULL ORDER BY flash_offer_id`,
    [orderId],
  )
  return rows.map((r) => ({ flashOfferId: r.flash_offer_id, quantity: r.quantity }))
}

export interface StockLine {
  productId: string
  quantity: number
  reason?: 'SALE' | 'FLASH_SALE' | 'COMBO_COMPONENT'
}

// Linhas que mexem no ESTOQUE: itens comuns como estão; combo vira seus componentes (movimento COMBO_COMPONENT);
// prato do dia não entra (a baixa dele é a porção do cardápio, feita na criação do pedido).
export async function listOrderLines(db: Queryable, orderId: string): Promise<StockLine[]> {
  const { rows } = await db.query<{ product_id: string; quantity: number; reason: StockLine['reason'] }>(
    `SELECT product_id, quantity::int AS quantity, reason FROM (
       SELECT oi.product_id, oi.quantity, 'SALE' AS reason
         FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 AND p.kind = 'ITEM'
       UNION ALL
       SELECT ci.component_id, ci.quantity * oi.quantity, 'COMBO_COMPONENT'
         FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.kind = 'COMBO'
         JOIN combo_items ci ON ci.combo_id = oi.product_id
        WHERE oi.order_id = $1
     ) l ORDER BY product_id, reason`,
    [orderId],
  )
  return rows.map((r) => ({ productId: r.product_id, quantity: r.quantity, reason: r.reason }))
}

/**
 * Baixa atômica: `UPDATE ... WHERE stock_qty >= q` decide no próprio banco, sem ler-e-gravar,
 * então duas vendas simultâneas do último item nunca deixam o saldo negativo.
 * As linhas vêm ordenadas por produto para duas transações não se travarem mutuamente (deadlock).
 * Retorna as faltas; quem chama dá ROLLBACK se houver alguma.
 */
export interface StockContext {
  orderId?: string
  reason?: 'SALE' | 'FLASH_SALE'
}

export async function decrementStock(
  db: DbClient,
  lines: StockLine[],
  ctx: StockContext = {},
): Promise<{ productId: string; requested: number; available: number }[]> {
  const shortages: { productId: string; requested: number; available: number }[] = []
  for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    // UPDATE condicional + lançamento no livro de estoque na mesma instrução.
    const { rowCount } = await db.query(
      `WITH u AS (UPDATE products SET stock_qty = stock_qty - $2::int WHERE id = $1 AND stock_qty >= $2::int RETURNING id, user_id, stock_qty)
       INSERT INTO stock_movements (product_id, merchant_id, delta, stock_after, reason, order_id)
       SELECT id, user_id, -$2::int, stock_qty, $3, $4 FROM u`,
      [line.productId, line.quantity, line.reason ?? ctx.reason ?? 'SALE', ctx.orderId ?? null],
    )
    if (rowCount === 0) {
      const { rows } = await db.query<{ stock_qty: number }>(`SELECT stock_qty FROM products WHERE id = $1`, [line.productId])
      shortages.push({ productId: line.productId, requested: line.quantity, available: rows[0]?.stock_qty ?? 0 })
    }
  }
  return shortages
}

export async function restoreStock(db: DbClient, lines: StockLine[], ctx: { orderId?: string } = {}): Promise<void> {
  for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    await db.query(
      `WITH u AS (UPDATE products SET stock_qty = stock_qty + $2::int WHERE id = $1 RETURNING id, user_id, stock_qty)
       INSERT INTO stock_movements (product_id, merchant_id, delta, stock_after, reason, order_id)
       SELECT id, user_id, $2::int, stock_qty, 'CANCEL_RETURN', $3 FROM u`,
      [line.productId, line.quantity, ctx.orderId ?? null],
    )
  }
}
