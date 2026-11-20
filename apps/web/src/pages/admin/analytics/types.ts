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
  /** Ofertas com ao menos uma compra confirmada no período (numerador da taxa). */
  offersWithPurchase: number
  /** Compras de cupom confirmadas pelo cliente no período. */
  couponsConfirmed: number
  /** Igual a couponsConfirmed (nome antigo, mantido por compatibilidade). */
  couponsRedeemed: number
}

export interface ConversionKpi extends Kpi {
  sessions: number
  onlineOrders: number
  /** Compras de cupom de oferta confirmadas; `funnel.orders` = onlineOrders + couponPurchases. */
  couponPurchases: number
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

export type PaymentMethod = 'pix' | 'card' | 'cash' | 'coupon' | 'unknown'

export interface PaymentSlice {
  method: PaymentMethod
  label: string
  orders: number
  revenue: number
  share: number
}

/** Divisão do período atual por canal. Lucro só existe no cupom. */
export interface ChannelsBreakdown {
  online: { orders: number; revenue: number }
  coupon: { orders: number; revenue: number; profit: number }
}

export interface TopOffer {
  productName: string
  chain: { slug: string; name: string }
  purchases: number
  units: number
  revenue: number
  profit: number
}

export interface TopCustomer {
  customerId: string
  name: string
  purchases: number
  spent: number
  profit: number
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
    /** Lucro do VizinhoHub: desconto das ofertas compradas por cupom confirmado. */
    profit: Kpi
    flyerConversion: FlyerConversionKpi
    conversion: ConversionKpi
  }
  hourly: HourlyPoint[]
  peak: HourlyPoint | null
  abc: { totalProducts: number; totalRevenue: number; items: AbcItem[]; classes: AbcClassSummary[] }
  payments: PaymentSlice[]
  channels: ChannelsBreakdown
  topOffers: TopOffer[]
  topCustomers: TopCustomer[]
}

export interface DateRange {
  startDate: string
  endDate: string
}
