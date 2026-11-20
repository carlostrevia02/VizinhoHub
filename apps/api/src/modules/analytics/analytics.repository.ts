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

// Totais por canal; o serviço soma os dois para os KPIs e devolve a divisão em `channels`.
// "online" = tabela orders (pedidos filtrados por status); "coupon" = cupons confirmados (REDEEMED) pela data de redeemed_at.
export interface KpiRow {
  onlineOrders: number
  onlineRevenue: number
  prevOnlineOrders: number
  prevOnlineRevenue: number
  couponOrders: number
  couponRevenue: number
  couponProfit: number
  prevCouponOrders: number
  prevCouponRevenue: number
  prevCouponProfit: number
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
export interface FunnelRow {
  sessions: number
  productViews: number
  addToCart: number
  checkouts: number
  onlineOrders: number
  couponPurchases: number
}
export interface FlyerRow {
  flyers: number
  offersExtracted: number
  offersWithCoupon: number
  offersWithPurchase: number
  couponsConfirmed: number
  couponsRedeemed: number
}
export interface TopOfferRow {
  productName: string
  chain: { slug: string; name: string }
  purchases: number
  units: number
  revenue: number
  profit: number
}
export interface TopCustomerRow {
  customerId: string
  name: string
  purchases: number
  spent: number
  profit: number
}

// Cupom é do comerciante M quando a fonte (source_id) da oferta está em qualquer encarte dele enviado com sucesso
// (sem restringir a data do envio). Venda = cupom CONFIRMADO (status REDEEMED) com redeemed_at no intervalo semiaberto
// (índice parcial idx_coupons_redeemed). Cupom emitido e não confirmado, ou vencido, NÃO é venda.
// `m` = parâmetro do comerciante; `a`/`b` = parâmetros das datas inicial e final. Define os apelidos k (deal_coupons) e d (deals).
const couponSales = (m: string, a: string, b: string) => `FROM deal_coupons k
              JOIN deals d ON d.id = k.deal_id
             WHERE k.status = 'REDEEMED'
               AND k.redeemed_at >= ${startOf(a)}
               AND k.redeemed_at <  ${endOf(b)}
               AND d.source_id IN (SELECT f.source_id FROM flyer_uploads f
                                    WHERE f.uploader_id = ${m} AND f.status = 'SUCCESS' AND f.source_id IS NOT NULL)`
// Valor da compra e lucro do VizinhoHub (o supermercado paga a diferença entre o "de" e o "por" do encarte).
const COUPON_VALUE = 'k.unit_price * k.min_qty'
const COUPON_PROFIT = '(k.original_price - k.unit_price) * k.min_qty'

// Cada método = uma consulta enxuta e independente; o serviço as dispara em paralelo (Promise.all).
export function createAnalyticsRepository(db: Db) {
  return {
    /** Funil da vitrine no período: sessões (STORE_VIEW distintas), pedidos online e cupons confirmados. Base da Conversão. */
    async funnel(merchantId: string, p: Period, statuses: OrderStatus[]): Promise<FunnelRow> {
      const { rows } = await db.query<FunnelRow>(
        `SELECT (SELECT count(DISTINCT session_id) FROM store_events e
                  WHERE e.merchant_id = $1 AND e.type = 'STORE_VIEW' AND e.created_at >= ${startOf('$2')} AND e.created_at < ${endOf('$3')})::int AS "sessions",
                (SELECT count(DISTINCT session_id) FROM store_events e
                  WHERE e.merchant_id = $1 AND e.type = 'PRODUCT_VIEW' AND e.created_at >= ${startOf('$2')} AND e.created_at < ${endOf('$3')})::int AS "productViews",
                (SELECT count(DISTINCT session_id) FROM store_events e
                  WHERE e.merchant_id = $1 AND e.type = 'ADD_TO_CART' AND e.created_at >= ${startOf('$2')} AND e.created_at < ${endOf('$3')})::int AS "addToCart",
                (SELECT count(DISTINCT session_id) FROM store_events e
                  WHERE e.merchant_id = $1 AND e.type = 'CHECKOUT_START' AND e.created_at >= ${startOf('$2')} AND e.created_at < ${endOf('$3')})::int AS "checkouts",
                (SELECT count(*) FROM orders o
                  WHERE o.merchant_id = $1 AND o.channel = 'ONLINE' AND o.status = ANY($4::order_status[])
                    AND o.created_at >= ${startOf('$2')} AND o.created_at < ${endOf('$3')})::int AS "onlineOrders",
                (SELECT count(*) ${couponSales('$1', '$2', '$3')})::int AS "couponPurchases"`,
        [merchantId, p.startDate, p.endDate, statuses],
      )
      return rows[0]!
    },

    /**
     * Faturamento e nº de compras do período atual e do anterior, por canal, numa única consulta:
     * pedidos (índice de orders) + cupons confirmados (índice parcial idx_coupons_redeemed). O lucro vem só dos cupons.
     */
    async kpis(merchantId: string, current: Period, previous: Period, statuses: OrderStatus[]): Promise<KpiRow> {
      const { rows } = await db.query<KpiRow>(
        `WITH o AS (
           SELECT count(*) FILTER (WHERE o.created_at >= ${startOf('$4')})::int                         AS orders,
                  coalesce(sum(o.total_price) FILTER (WHERE o.created_at >= ${startOf('$4')}), 0)::float8 AS revenue,
                  count(*) FILTER (WHERE o.created_at <  ${startOf('$4')})::int                         AS prev_orders,
                  coalesce(sum(o.total_price) FILTER (WHERE o.created_at <  ${startOf('$4')}), 0)::float8 AS prev_revenue
             FROM orders o
            WHERE o.merchant_id = $1
              AND o.created_at >= ${startOf('$2')}
              AND o.created_at <  ${endOf('$3')}
              AND o.status = ANY($5::order_status[])
         ),
         c AS (
           SELECT count(*) FILTER (WHERE k.redeemed_at >= ${startOf('$4')})::int                              AS orders,
                  coalesce(sum(${COUPON_VALUE}) FILTER (WHERE k.redeemed_at >= ${startOf('$4')}), 0)::float8   AS revenue,
                  coalesce(sum(${COUPON_PROFIT}) FILTER (WHERE k.redeemed_at >= ${startOf('$4')}), 0)::float8  AS profit,
                  count(*) FILTER (WHERE k.redeemed_at <  ${startOf('$4')})::int                              AS prev_orders,
                  coalesce(sum(${COUPON_VALUE}) FILTER (WHERE k.redeemed_at <  ${startOf('$4')}), 0)::float8   AS prev_revenue,
                  coalesce(sum(${COUPON_PROFIT}) FILTER (WHERE k.redeemed_at <  ${startOf('$4')}), 0)::float8  AS prev_profit
           ${couponSales('$1', '$2', '$3')}
         )
         SELECT o.orders AS "onlineOrders", o.revenue AS "onlineRevenue", o.prev_orders AS "prevOnlineOrders", o.prev_revenue AS "prevOnlineRevenue",
                c.orders AS "couponOrders", c.revenue AS "couponRevenue", c.profit AS "couponProfit",
                c.prev_orders AS "prevCouponOrders", c.prev_revenue AS "prevCouponRevenue", c.prev_profit AS "prevCouponProfit"
           FROM o, c`,
        [merchantId, previous.startDate, current.endDate, current.startDate, statuses],
      )
      return rows[0]!
    },

    /** Vendas por hora do dia (0–23, horário de Fortaleza), com as horas vazias preenchidas com zero. Cupom conta na hora de redeemed_at. */
    async hourly(merchantId: string, p: Period, statuses: OrderStatus[]): Promise<HourRow[]> {
      const { rows } = await db.query<HourRow>(
        `SELECT h AS "hour", coalesce(x.orders, 0)::int AS "orders", coalesce(x.revenue, 0)::float8 AS "revenue"
           FROM generate_series(0, 23) h
           LEFT JOIN (
             SELECT u.hour, count(*) AS orders, sum(u.revenue) AS revenue
               FROM (
                 SELECT extract(hour FROM o.created_at AT TIME ZONE '${TZ}')::int AS hour, o.total_price AS revenue
                   FROM orders o
                  WHERE o.merchant_id = $1
                    AND o.created_at >= ${startOf('$2')}
                    AND o.created_at <  ${endOf('$3')}
                    AND o.status = ANY($4::order_status[])
                 UNION ALL
                 SELECT extract(hour FROM k.redeemed_at AT TIME ZONE '${TZ}')::int, ${COUPON_VALUE}
                   ${couponSales('$1', '$2', '$3')}
               ) u
              GROUP BY 1
           ) x ON x.hour = h
          ORDER BY h`,
        [merchantId, p.startDate, p.endDate, statuses],
      )
      return rows
    },

    /** Faturamento por método de pagamento. Venda de balcão / sem informação cai em "unknown"; cupom confirmado = "coupon". */
    async payments(merchantId: string, p: Period, statuses: OrderStatus[]): Promise<PaymentRow[]> {
      const { rows } = await db.query<PaymentRow>(
        `SELECT u.method AS "method", count(*)::int AS "orders", sum(u.revenue)::float8 AS "revenue"
           FROM (
             SELECT coalesce(o.payment_method, 'unknown')::text AS method, o.total_price AS revenue
               FROM orders o
              WHERE o.merchant_id = $1
                AND o.created_at >= ${startOf('$2')}
                AND o.created_at <  ${endOf('$3')}
                AND o.status = ANY($4::order_status[])
             UNION ALL
             SELECT 'coupon', ${COUPON_VALUE}
               ${couponSales('$1', '$2', '$3')}
           ) u
          GROUP BY 1
          ORDER BY revenue DESC, "method"`,
        [merchantId, p.startDate, p.endDate, statuses],
      )
      return rows
    },

    /**
     * Curva ABC (Pareto) por faturamento de item. SÓ pedidos online (order_items): cupom de oferta não tem product_id
     * do catálogo e não entra aqui. Uma passada só:
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
     * no período, quantas tiveram ao menos uma COMPRA confirmada (cupom REDEEMED com redeemed_at no período).
     * A oferta pertence à fonte (rede + bairro) do encarte, então a atribuição é por fonte; "oferta do período" =
     * vista (last_seen_at) no período. Cupom emitido e não confirmado não é venda: só alimenta offersWithCoupon.
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
                count(*) FILTER (WHERE cp.confirmed > 0)::int AS "offersWithPurchase",
                coalesce(sum(cp.confirmed), 0)::int AS "couponsConfirmed",
                coalesce(sum(cp.confirmed), 0)::int AS "couponsRedeemed"
           FROM d
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE c.created_at >= ${startOf('$2')} AND c.created_at < ${endOf('$3')}) AS issued,
                    count(*) FILTER (WHERE c.status = 'REDEEMED' AND c.redeemed_at >= ${startOf('$2')} AND c.redeemed_at < ${endOf('$3')}) AS confirmed
               FROM deal_coupons c
              WHERE c.deal_id = d.id
           ) cp ON true`,
        [merchantId, p.startDate, p.endDate],
      )
      return rows[0]!
    },

    /** Ofertas de supermercado mais lucrativas no período (só compras confirmadas): uma linha por oferta (deal). */
    async topOffers(merchantId: string, p: Period, limit: number): Promise<TopOfferRow[]> {
      const { rows } = await db.query<TopOfferRow>(
        `SELECT d.product_name AS "productName",
                (SELECT json_build_object('slug', c.slug, 'name', c.name) FROM retail_chains c WHERE c.id = d.chain_id) AS "chain",
                count(*)::int AS "purchases",
                sum(k.min_qty)::int AS "units",
                sum(${COUPON_VALUE})::float8 AS "revenue",
                sum(${COUPON_PROFIT})::float8 AS "profit"
           ${couponSales('$1', '$2', '$3')}
          GROUP BY d.id, d.chain_id, d.product_name
          ORDER BY sum(${COUPON_PROFIT}) DESC, d.product_name, d.id
          LIMIT $4`,
        [merchantId, p.startDate, p.endDate, limit],
      )
      return rows
    },

    /** Clientes que mais compraram no período: pedidos válidos (venda de balcão sem cliente fica de fora) + cupons confirmados. */
    async topCustomers(merchantId: string, p: Period, statuses: OrderStatus[], limit: number): Promise<TopCustomerRow[]> {
      const { rows } = await db.query<TopCustomerRow>(
        `SELECT u.id AS "customerId", u.name AS "name",
                sum(x.purchases)::int AS "purchases", sum(x.spent)::float8 AS "spent", sum(x.profit)::float8 AS "profit"
           FROM (
             SELECT o.customer_id, count(*) AS purchases, sum(o.total_price) AS spent, 0::numeric AS profit
               FROM orders o
              WHERE o.merchant_id = $1
                AND o.customer_id IS NOT NULL
                AND o.created_at >= ${startOf('$2')}
                AND o.created_at <  ${endOf('$3')}
                AND o.status = ANY($4::order_status[])
              GROUP BY o.customer_id
             UNION ALL
             SELECT k.customer_id, count(*), sum(${COUPON_VALUE}), sum(${COUPON_PROFIT})
               ${couponSales('$1', '$2', '$3')}
              GROUP BY k.customer_id
           ) x
           JOIN users u ON u.id = x.customer_id
          GROUP BY u.id, u.name
          ORDER BY sum(x.spent) DESC, u.name, u.id
          LIMIT $5`,
        [merchantId, p.startDate, p.endDate, statuses, limit],
      )
      return rows
    },
  }
}
export type AnalyticsRepository = ReturnType<typeof createAnalyticsRepository>
