// Espelho de apps/api/src/modules/analytics/analytics.types.ts (contrato de GET /analytics/dashboard).
// Reais em `number`; share = fração de 0 a 1; changePct em %.

export interface Kpi {
  value: number
  previous: number
  changePct: number | null
}

export interface FlyerConversionKpi extends Kpi {
  flyers: number
  offersExtracted: number
  offersWithCoupon: number
  couponsRedeemed: number
}

export interface ConversionKpi extends Kpi {
  sessions: number
  onlineOrders: number
  funnel: { storeViews: number; productViews: number; addToCart: number; checkouts: number; orders: number }
}

export interface HourlyPoint {
  hour: number
  label: string
  orders: number
  revenue: number
}

export type AbcClass = 'A' | 'B' | 'C'

export interface AbcItem {
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

export interface AbcClassSummary {
  class: AbcClass
  products: number
  productsShare: number
  revenue: number
  revenueShare: number
}

export type PaymentMethod = 'pix' | 'card' | 'cash' | 'unknown'

export interface PaymentSlice {
  method: PaymentMethod
  label: string
  orders: number
  revenue: number
  share: number
}

export interface AnalyticsDashboard {
  range: {
    startDate: string
    endDate: string
    previousStartDate: string
    previousEndDate: string
    days: number
    timezone: string
    statuses: string[]
  }
  kpis: {
    revenue: Kpi
    orders: Kpi
    averageTicket: Kpi
    flyerConversion: FlyerConversionKpi
    conversion: ConversionKpi
  }
  hourly: HourlyPoint[]
  peak: HourlyPoint | null
  abc: { totalProducts: number; totalRevenue: number; items: AbcItem[]; classes: AbcClassSummary[] }
  payments: PaymentSlice[]
}

export interface DateRange {
  startDate: string
  endDate: string
}
