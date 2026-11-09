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

const PAYMENT_LABELS: Record<PaymentSlice['method'], string> = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', unknown: 'Não informado' }

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

      const [k, hourRows, paymentRows, abc, flyers, prevFlyers, funnel, prevFunnel] = await Promise.all([
        repo.kpis(merchantId, current, previous, statuses),
        repo.hourly(merchantId, current, statuses),
        repo.payments(merchantId, current, statuses),
        repo.abc(merchantId, current, statuses, query.abcTop),
        repo.flyers(merchantId, current),
        repo.flyers(merchantId, previous),
        repo.funnel(merchantId, current, statuses),
        repo.funnel(merchantId, previous, statuses),
      ])
      const conv = (f: { sessions: number; onlineOrders: number }) => (f.sessions ? Math.min(100, (f.onlineOrders / f.sessions) * 100) : 0)

      const ticket = (revenue: number, orders: number) => (orders ? revenue / orders : 0)
      const rate = (f: { offersExtracted: number; offersWithCoupon: number }) => (f.offersExtracted ? (f.offersWithCoupon / f.offersExtracted) * 100 : 0)

      const hourly: HourlyPoint[] = hourRows.map((h) => ({
        hour: h.hour,
        label: `${String(h.hour).padStart(2, '0')}h`,
        orders: h.orders,
        revenue: round(h.revenue),
      }))
      const best = hourly.reduce<HourlyPoint | null>((top, h) => (h.revenue > (top?.revenue ?? 0) ? h : top), null)

      const paymentTotal = paymentRows.reduce((s, p) => s + p.revenue, 0)
      const payments: PaymentSlice[] = paymentRows.map((p) => {
        const method = (p.method in PAYMENT_LABELS ? p.method : 'unknown') as PaymentSlice['method']
        return { method, label: PAYMENT_LABELS[method], orders: p.orders, revenue: round(p.revenue), share: paymentTotal ? round(p.revenue / paymentTotal, 4) : 0 }
      })

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
          revenue: kpi(k.revenue, k.prevRevenue),
          orders: kpi(k.orders, k.prevOrders),
          averageTicket: kpi(ticket(k.revenue, k.orders), ticket(k.prevRevenue, k.prevOrders)),
          flyerConversion: { ...kpi(rate(flyers), rate(prevFlyers)), ...flyers },
          conversion: {
            ...kpi(conv(funnel), conv(prevFunnel)),
            sessions: funnel.sessions,
            onlineOrders: funnel.onlineOrders,
            funnel: { storeViews: funnel.sessions, productViews: funnel.productViews, addToCart: funnel.addToCart, checkouts: funnel.checkouts, orders: funnel.onlineOrders },
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
      }
    },
  }
}
export type AnalyticsService = ReturnType<typeof createAnalyticsService>
