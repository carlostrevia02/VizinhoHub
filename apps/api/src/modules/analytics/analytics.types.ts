// Contrato do Dashboard Analítico. O frontend (apps/web/src/pages/admin/analytics/types.ts) espelha estes tipos.
// Valores em reais são `number` com 2 casas; participações (share) são frações de 0 a 1; variações (changePct) são em %.

export const ORDER_STATUSES = ['PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED', 'CANCELLED'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Pedidos que contam como venda: tudo menos CANCELLED. */
export const VALID_STATUSES: readonly OrderStatus[] = ['PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED']

export interface Kpi {
  value: number
  /** Mesmo indicador no período anterior (mesma duração, logo antes). */
  previous: number
  /** (value - previous) / previous * 100; null quando não há base de comparação (previous = 0 e value > 0). */
  changePct: number | null
}

export interface FlyerConversionKpi extends Kpi {
  /** Encartes (PDF/imagem lidos por OCR/IA) enviados com sucesso no período. */
  flyers: number
  /** Ofertas extraídas desses encartes. */
  offersExtracted: number
  /** Ofertas que geraram ao menos um cupom de retirada. */
  offersWithCoupon: number
  /** Cupons já retirados no caixa. */
  couponsRedeemed: number
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

export interface PaymentSlice {
  method: 'pix' | 'card' | 'cash' | 'unknown'
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
    statuses: OrderStatus[]
  }
  kpis: {
    revenue: Kpi
    orders: Kpi
    averageTicket: Kpi
    flyerConversion: FlyerConversionKpi
  }
  hourly: HourlyPoint[]
  /** Hora de maior faturamento (null se não houve vendas). */
  peak: HourlyPoint | null
  abc: {
    totalProducts: number
    totalRevenue: number
    /** Os `top` primeiros produtos; o resumo por classe considera todos. */
    items: AbcItem[]
    classes: AbcClassSummary[]
  }
  payments: PaymentSlice[]
}
