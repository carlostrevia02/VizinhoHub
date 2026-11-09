import type { Db } from '../../shared/db.js'
import type { AbcClass, OrderStatus } from './analytics.types.js'

export const TZ = 'America/Fortaleza'

// Intervalos SEMIABERTOS sobre a coluna crua (created_at >= início AND created_at < fim do último dia):
// é o que deixa o Postgres usar idx_orders_merchant_created_cover. Filtrar por
// (created_at AT TIME ZONE ...)::date BETWEEN ... obrigaria a varrer todos os pedidos da loja.
// "Dia" = dia em Fortaleza, como no resto da API. As datas chegam como parâmetros ($n::date).
const startOf = (p: string) => `(${p}::date)::timestamp AT TIME ZONE '${TZ}'`
const endOf = (p: string) => `((${p}::date + 1)::timestamp AT TIME ZONE '${TZ}')`

export interface Period {
  startDate: string
  endDate: string
}

export interface KpiRow {
  orders: number
  revenue: number
  prevOrders: number
  prevRevenue: number
}
export interface HourRow {
  hour: number
  orders: number
  revenue: number
}
export interface PaymentRow {
  method: string
  orders: number
  revenue: number
}
export interface AbcRow {
  rank: number
  productId: string
  name: string
  category: string
  quantity: number
  revenue: number
  share: number
  cumulativeShare: number
  class: AbcClass
}
export interface AbcResult {
  totalProducts: number
  totalRevenue: number
  items: AbcRow[]
  classes: { class: AbcClass; products: number; revenue: number }[]
}
export interface FlyerRow {
  flyers: number
  offersExtracted: number
  offersWithCoupon: number
  couponsRedeemed: number
}

// Cada método = uma consulta enxuta e independente; o serviço as dispara em paralelo (Promise.all).
export function createAnalyticsRepository(db: Db) {
  return {
    /** Faturamento e nº de pedidos do período atual e do anterior, numa única passada pelo índice. */
    async kpis(merchantId: string, current: Period, previous: Period, statuses: OrderStatus[]): Promise<KpiRow> {
      const { rows } = await db.query<KpiRow>(
        `SELECT count(*) FILTER (WHERE o.created_at >= ${startOf('$4')})::int                         AS "orders",
                coalesce(sum(o.total_price) FILTER (WHERE o.created_at >= ${startOf('$4')}), 0)::float8 AS "revenue",
                count(*) FILTER (WHERE o.created_at <  ${startOf('$4')})::int                         AS "prevOrders",
                coalesce(sum(o.total_price) FILTER (WHERE o.created_at <  ${startOf('$4')}), 0)::float8 AS "prevRevenue"
           FROM orders o
          WHERE o.merchant_id = $1
            AND o.created_at >= ${startOf('$2')}
            AND o.created_at <  ${endOf('$3')}
            AND o.status = ANY($5::order_status[])`,
        [merchantId, previous.startDate, current.endDate, current.startDate, statuses],
      )
      return rows[0]!
    },

    /** Vendas por hora do dia (0–23, horário de Fortaleza), com as horas vazias preenchidas com zero. */
    async hourly(merchantId: string, p: Period, statuses: OrderStatus[]): Promise<HourRow[]> {
      const { rows } = await db.query<HourRow>(
        `SELECT h AS "hour", coalesce(x.orders, 0)::int AS "orders", coalesce(x.revenue, 0)::float8 AS "revenue"
           FROM generate_series(0, 23) h
           LEFT JOIN (
             SELECT extract(hour FROM o.created_at AT TIME ZONE '${TZ}')::int AS hour,
                    count(*) AS orders, sum(o.total_price) AS revenue
               FROM orders o
              WHERE o.merchant_id = $1
                AND o.created_at >= ${startOf('$2')}
                AND o.created_at <  ${endOf('$3')}
                AND o.status = ANY($4::order_status[])
              GROUP BY 1
           ) x ON x.hour = h
          ORDER BY h`,
        [merchantId, p.startDate, p.endDate, statuses],
      )
      return rows
    },

    /** Faturamento por método de pagamento. Venda de balcão / sem informação cai em "unknown". */
    async payments(merchantId: string, p: Period, statuses: OrderStatus[]): Promise<PaymentRow[]> {
      const { rows } = await db.query<PaymentRow>(
        `SELECT coalesce(o.payment_method, 'unknown') AS "method", count(*)::int AS "orders", sum(o.total_price)::float8 AS "revenue"
           FROM orders o
          WHERE o.merchant_id = $1
            AND o.created_at >= ${startOf('$2')}
            AND o.created_at <  ${endOf('$3')}
            AND o.status = ANY($4::order_status[])
          GROUP BY 1
          ORDER BY revenue DESC, "method"`,
        [merchantId, p.startDate, p.endDate, statuses],
      )
      return rows
    },

    /**
     * Curva ABC (Pareto) por faturamento de item. Uma passada só:
     *   sold   → receita por produto no período
     *   ranked → participação e participação acumulada (window function)
     * A classe vem da participação acumulada ANTES do produto: A enquanto o acumulado anterior < 80 %
     * (o produto que cruza os 80 % ainda é A), B até 95 %, C o resto. O resumo por classe usa todos os
     * produtos; só a lista devolvida é cortada em `top`.
     */
    async abc(merchantId: string, p: Period, statuses: OrderStatus[], top: number): Promise<AbcResult> {
      const { rows } = await db.query<{ total_products: number; total_revenue: number; items: AbcRow[]; classes: AbcResult['classes'] }>(
        `WITH sold AS (
           SELECT oi.product_id, sum(oi.quantity)::int AS quantity, sum(oi.quantity * oi.unit_price) AS revenue
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
            WHERE o.merchant_id = $1
              AND o.created_at >= ${startOf('$2')}
              AND o.created_at <  ${endOf('$3')}
              AND o.status = ANY($4::order_status[])
            GROUP BY oi.product_id
         ),
         ranked AS (
           SELECT s.product_id, s.quantity, s.revenue,
                  row_number() OVER w AS rank,
                  s.revenue / nullif(sum(s.revenue) OVER (), 0) AS share,
                  sum(s.revenue) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / nullif(sum(s.revenue) OVER (), 0) AS cum_share
             FROM sold s
           WINDOW w AS (ORDER BY s.revenue DESC, s.product_id)
         ),
         classed AS (
           SELECT r.*,
                  CASE WHEN coalesce(r.cum_share - r.share, 0) < 0.80 THEN 'A'
                       WHEN coalesce(r.cum_share - r.share, 0) < 0.95 THEN 'B'
                       ELSE 'C' END AS class
             FROM ranked r
         )
         SELECT (SELECT count(*) FROM classed)::int AS total_products,
                (SELECT coalesce(sum(revenue), 0) FROM classed)::float8 AS total_revenue,
                (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'rank', c.rank, 'productId', c.product_id, 'name', pr.name, 'category', cat.name,
                          'quantity', c.quantity, 'revenue', c.revenue, 'share', c.share,
                          'cumulativeShare', c.cum_share, 'class', c.class) ORDER BY c.rank), '[]'::jsonb)
                   FROM classed c
                   JOIN products pr ON pr.id = c.product_id
                   JOIN categories cat ON cat.id = pr.category_id
                  WHERE c.rank <= $5) AS items,
                (SELECT coalesce(jsonb_agg(jsonb_build_object('class', k.class, 'products', k.products, 'revenue', k.revenue) ORDER BY k.class), '[]'::jsonb)
                   FROM (SELECT class, count(*) AS products, sum(revenue) AS revenue FROM classed GROUP BY class) k) AS classes`,
        [merchantId, p.startDate, p.endDate, statuses, top],
      )
      const r = rows[0]!
      return { totalProducts: r.total_products, totalRevenue: r.total_revenue, items: r.items, classes: r.classes }
    },

    /**
     * Conversão dos encartes lidos por OCR/IA: das ofertas extraídas dos encartes que ESTE comerciante enviou
     * no período, quantas viraram cupom de retirada. A oferta pertence à fonte (rede + bairro) do encarte, então
     * a atribuição é por fonte; "oferta do período" = vista (last_seen_at) no período.
     */
    async flyers(merchantId: string, p: Period): Promise<FlyerRow> {
      const { rows } = await db.query<FlyerRow>(
        `WITH up AS (
           SELECT f.source_id
             FROM flyer_uploads f
            WHERE f.uploader_id = $1 AND f.status = 'SUCCESS'
              AND f.created_at >= ${startOf('$2')} AND f.created_at < ${endOf('$3')}
         ),
         d AS (
           SELECT d.id
             FROM deals d
            WHERE d.source_id IN (SELECT source_id FROM up WHERE source_id IS NOT NULL)
              AND d.last_seen_at >= ${startOf('$2')} AND d.last_seen_at < ${endOf('$3')}
         )
         SELECT (SELECT count(*) FROM up)::int AS "flyers",
                count(*)::int AS "offersExtracted",
                count(*) FILTER (WHERE cp.issued > 0)::int AS "offersWithCoupon",
                coalesce(sum(cp.redeemed), 0)::int AS "couponsRedeemed"
           FROM d
           LEFT JOIN LATERAL (
             SELECT count(*) AS issued, count(*) FILTER (WHERE c.status = 'REDEEMED') AS redeemed
               FROM deal_coupons c
              WHERE c.deal_id = d.id
                AND c.created_at >= ${startOf('$2')} AND c.created_at < ${endOf('$3')}
           ) cp ON true`,
        [merchantId, p.startDate, p.endDate],
      )
      return rows[0]!
    },
  }
}
export type AnalyticsRepository = ReturnType<typeof createAnalyticsRepository>
