import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { requireRole } from '../../shared/auth.js'
import type { Db } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

const TZ = 'America/Fortaleza'
const MAX_DAYS = 366

const querySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  top: z.coerce.number().int().min(1).max(50).default(10),
})

// Relatórios da loja (só comerciante). Pedidos CANCELADOS não contam como venda; "dia" = dia em Fortaleza.
export function reportsRouter(db: Db, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin, requireRole('MERCHANT'))

  router.get('/summary', async (req, res) => {
    const q = querySchema.parse(req.query)
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1
    if (days < 1) throw new AppError(422, 'INVALID_RANGE', '"to" não pode ser anterior a "from".')
    if (days > MAX_DAYS) throw new AppError(422, 'RANGE_TOO_LARGE', `O período pode ter no máximo ${MAX_DAYS} dias.`)

    const range = `o.merchant_id = $1 AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date`
    const args = [req.user!.id, q.from, q.to]

    const [totals, daily, byCategory, top] = await Promise.all([
      db.query(
        `SELECT count(*) FILTER (WHERE o.status <> 'CANCELLED')::int AS orders,
                count(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
                coalesce(sum(o.total_price) FILTER (WHERE o.status <> 'CANCELLED'), 0)::float8 AS revenue
           FROM orders o WHERE ${range}`,
        args,
      ),
      db.query(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS date,
                coalesce(sum(o.total_price) FILTER (WHERE o.status <> 'CANCELLED'), 0)::float8 AS revenue,
                count(o.id) FILTER (WHERE o.status <> 'CANCELLED')::int AS orders
           FROM generate_series($2::date, $3::date, interval '1 day') d
           LEFT JOIN orders o ON o.merchant_id = $1 AND (o.created_at AT TIME ZONE '${TZ}')::date = d::date
          GROUP BY d ORDER BY d`,
        args,
      ),
      db.query(
        `SELECT c.name, sum(oi.quantity * oi.unit_price)::float8 AS revenue
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           JOIN products p ON p.id = oi.product_id
           JOIN categories c ON c.id = p.category_id
          WHERE ${range} AND o.status <> 'CANCELLED'
          GROUP BY c.name ORDER BY revenue DESC`,
        args,
      ),
      db.query(
        `SELECT p.id AS "productId", p.name, p.image, c.name AS category,
                sum(oi.quantity)::int AS quantity, sum(oi.quantity * oi.unit_price)::float8 AS revenue
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           JOIN products p ON p.id = oi.product_id
           JOIN categories c ON c.id = p.category_id
          WHERE ${range} AND o.status <> 'CANCELLED'
          GROUP BY p.id, c.name ORDER BY quantity DESC, p.name LIMIT $4`,
        [...args, q.top],
      ),
    ])

    const t = totals.rows[0]!
    res.json({
      from: q.from,
      to: q.to,
      orders: t.orders,
      cancelled: t.cancelled,
      revenue: t.revenue,
      averageTicket: t.orders ? Math.round((t.revenue / t.orders) * 100) / 100 : 0,
      cancelRate: t.orders + t.cancelled ? t.cancelled / (t.orders + t.cancelled) : 0,
      daily: daily.rows,
      byCategory: byCategory.rows,
      topProducts: top.rows,
    })
  })

  return router
}
