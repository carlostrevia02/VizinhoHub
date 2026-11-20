import { AppError } from '../../shared/errors.js'
import { MAX_DAYS, type DashboardQuery } from './analytics.schema.js'
import { TZ, type AnalyticsRepository } from './analytics.repository.js'
import type { AbcClass, AbcClassSummary, AnalyticsDashboard, HourlyPoint, Kpi, PaymentSlice } from './analytics.types.js'

const DAY_MS = 86_400_000
const round = (n: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round((n + Number.EPSILON) * f) / f
}
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10)
const todayInFortaleza = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()) // YYYY-MM-DD

const PAYMENT_LABELS: Record<PaymentSlice['method'], string> = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', coupon: 'Cupom (retirada)', unknown: 'Não informado' }
const TOP_LIMIT = 10

export function kpi(value: number, previous: number): Kpi {
  const changePct = previous > 0 ? round(((value - previous) / previous) * 100, 1) : value === 0 ? 0 : null
  return { value: round(value), previous: round(previous), changePct }
}

export function createAnalyticsService(repo: AnalyticsRepository) {
  return {
    async dashboard(merchantId: string, query: DashboardQuery): Promise<AnalyticsDashboard> {
      const endDate = query.endDate ?? todayInFortaleza()
      const startDate = query.startDate ?? addDays(endDate, -6)
      const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1
      if (days < 1) throw new AppError(422, 'INVALID_RANGE', '"endDate" não pode ser anterior a "startDate".')
      if (days > MAX_DAYS) throw new AppError(422, 'RANGE_TOO_LARGE', `O período pode ter no máximo ${MAX_DAYS} dias.`)

      const current = { startDate, endDate }
      // Período anterior: mesma duração, colado no início do atual (7 dias → os 7 dias antes).
      const previous = { startDate: addDays(startDate, -days), endDate: addDays(startDate, -1) }
      const { status: statuses } = query

      const [k, hourRows, paymentRows, abc, flyers, prevFlyers, funnel, prevFunnel, topOffers, topCustomers] = await Promise.all([
        repo.kpis(merchantId, current, previous, statuses),
        repo.hourly(merchantId, current, statuses),
        repo.payments(merchantId, current, statuses),
        repo.abc(merchantId, current, statuses, query.abcTop),
        repo.flyers(merchantId, current),
        repo.flyers(merchantId, previous),
        repo.funnel(merchantId, current, statuses),
        repo.funnel(merchantId, previous, statuses),
        repo.topOffers(merchantId, current, TOP_LIMIT),
        repo.topCustomers(merchantId, current, statuses, TOP_LIMIT),
      ])
      // Compra = pedido online + cupom confirmado.
      const purchases = (f: { onlineOrders: number; couponPurchases: number }) => f.onlineOrders + f.couponPurchases
      const conv = (f: { sessions: number; onlineOrders: number; couponPurchases: number }) => (f.sessions ? Math.min(100, (purchases(f) / f.sessions) * 100) : 0)

      const ticket = (revenue: number, orders: number) => (orders ? revenue / orders : 0)
      const rate = (f: { offersExtracted: number; offersWithPurchase: number }) => (f.offersExtracted ? (f.offersWithPurchase / f.offersExtracted) * 100 : 0)

      // Os dois canais somados: pedidos online (filtro de status) + cupons confirmados.
      const orders = k.onlineOrders + k.couponOrders
      const revenue = k.onlineRevenue + k.couponRevenue
      const prevOrders = k.prevOnlineOrders + k.prevCouponOrders
      const prevRevenue = k.prevOnlineRevenue + k.prevCouponRevenue

      const hourly: HourlyPoint[] = hourRows.map((h) => ({
        hour: h.hour,
        label: `${String(h.hour).padStart(2, '0')}h`,
        orders: h.orders,
        revenue: round(h.revenue),
      }))
      const best = hourly.reduce<HourlyPoint | null>((top, h) => (h.revenue > (top?.revenue ?? 0) ? h : top), null)

      const paymentTotal = paymentRows.reduce((s, p) => s + p.revenue, 0)
      // Valores fora da lista (ou sem forma de pagamento) viram "Não informado": várias linhas do banco podem cair
      // na mesma fatia, então soma antes de montar a resposta (senão a rosca mostraria "Não informado" duas vezes).
      const byMethod = new Map<PaymentSlice['method'], { orders: number; revenue: number }>()
      for (const p of paymentRows) {
        const method = (p.method in PAYMENT_LABELS ? p.method : 'unknown') as PaymentSlice['method']
        const acc = byMethod.get(method) ?? { orders: 0, revenue: 0 }
        byMethod.set(method, { orders: acc.orders + p.orders, revenue: acc.revenue + p.revenue })
      }
      const payments: PaymentSlice[] = [...byMethod]
        .map(([method, v]) => ({ method, label: PAYMENT_LABELS[method], orders: v.orders, revenue: round(v.revenue), share: paymentTotal ? round(v.revenue / paymentTotal, 4) : 0 }))
        .sort((a, b) => b.revenue - a.revenue || a.method.localeCompare(b.method))

      const classes: AbcClassSummary[] = (['A', 'B', 'C'] as AbcClass[]).map((c) => {
        const row = abc.classes.find((x) => x.class === c)
        return {
          class: c,
          products: row?.products ?? 0,
          productsShare: abc.totalProducts ? round((row?.products ?? 0) / abc.totalProducts, 4) : 0,
          revenue: round(row?.revenue ?? 0),
          revenueShare: abc.totalRevenue ? round((row?.revenue ?? 0) / abc.totalRevenue, 4) : 0,
        }
      })

      return {
        range: { startDate, endDate, previousStartDate: previous.startDate, previousEndDate: previous.endDate, days, timezone: TZ, statuses },
        kpis: {
          revenue: kpi(revenue, prevRevenue),
          orders: kpi(orders, prevOrders),
          averageTicket: kpi(ticket(revenue, orders), ticket(prevRevenue, prevOrders)),
          profit: kpi(k.couponProfit, k.prevCouponProfit),
          flyerConversion: { ...kpi(rate(flyers), rate(prevFlyers)), ...flyers },
          conversion: {
            ...kpi(conv(funnel), conv(prevFunnel)),
            sessions: funnel.sessions,
            onlineOrders: funnel.onlineOrders,
            couponPurchases: funnel.couponPurchases,
            funnel: { storeViews: funnel.sessions, productViews: funnel.productViews, addToCart: funnel.addToCart, checkouts: funnel.checkouts, orders: purchases(funnel) },
          },
        },
        hourly,
        peak: best,
        abc: {
          totalProducts: abc.totalProducts,
          totalRevenue: round(abc.totalRevenue),
          items: abc.items.map((i) => ({ ...i, revenue: round(i.revenue), share: round(i.share, 4), cumulativeShare: round(i.cumulativeShare, 4) })),
          classes,
        },
        payments,
        channels: {
          online: { orders: k.onlineOrders, revenue: round(k.onlineRevenue) },
          coupon: { orders: k.couponOrders, revenue: round(k.couponRevenue), profit: round(k.couponProfit) },
        },
        topOffers: topOffers.map((o) => ({ ...o, revenue: round(o.revenue), profit: round(o.profit) })),
        topCustomers: topCustomers.map((c) => ({ ...c, spent: round(c.spent), profit: round(c.profit) })),
      }
    },
  }
}
export type AnalyticsService = ReturnType<typeof createAnalyticsService>
