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

/** Conversão dos encartes = ofertas com ao menos uma compra confirmada ÷ ofertas extraídas (em %). */
export interface FlyerConversionKpi extends Kpi {
  /** Encartes (PDF/imagem lidos por OCR/IA) enviados com sucesso no período. */
  flyers: number
  /** Ofertas extraídas desses encartes. */
  offersExtracted: number
  /** Ofertas que geraram ao menos um cupom de retirada (emitido, confirmado ou não). */
  offersWithCoupon: number
  /** Ofertas com ao menos uma compra CONFIRMADA no período (cupom REDEEMED, por redeemed_at). Numerador da taxa. */
  offersWithPurchase: number
  /** Compras de cupom confirmadas pelo cliente no período (por redeemed_at). */
  couponsConfirmed: number
  /** Igual a couponsConfirmed (nome antigo, mantido por compatibilidade). */
  couponsRedeemed: number
}

export interface ConversionKpi extends Kpi {
  /** Visitas à vitrine (sessões distintas) no período atual. */
  sessions: number
  /** Pedidos online no período atual. */
  onlineOrders: number
  /** Compras de cupom de oferta confirmadas no período atual. */
  couponPurchases: number
  /** Passos do funil, em sessões distintas; `orders` = compras (pedidos online + cupons confirmados). */
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

export interface PaymentSlice {
  method: 'pix' | 'card' | 'cash' | 'coupon' | 'unknown'
  label: string
  orders: number
  revenue: number
  share: number
}

/** Divisão do período atual por canal de venda. Lucro só existe no cupom (o pedido online não gera lucro de oferta). */
export interface ChannelsBreakdown {
  online: { orders: number; revenue: number }
  coupon: { orders: number; revenue: number; profit: number }
}

/** Oferta de supermercado com compras confirmadas no período. */
export interface TopOffer {
  productName: string
  chain: { slug: string; name: string }
  purchases: number
  /** Soma de min_qty das compras. */
  units: number
  revenue: number
  profit: number
}

/** Cliente com mais compras no período (pedidos online válidos + cupons confirmados). */
export interface TopCustomer {
  customerId: string
  name: string
  purchases: number
  spent: number
  /** Lucro do VizinhoHub nas compras de cupom desse cliente. */
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
    statuses: OrderStatus[]
  }
  kpis: {
    /** Faturamento = pedidos online (filtro de status) + cupons confirmados. */
    revenue: Kpi
    /** Compras = pedidos online + cupons confirmados. */
    orders: Kpi
    averageTicket: Kpi
    /** Lucro do VizinhoHub: (preço base − preço do encarte) × quantidade mínima, só dos cupons confirmados. */
    profit: Kpi
    flyerConversion: FlyerConversionKpi
    /** Conversão = compras (pedidos online + cupons confirmados) ÷ visitas (em %, no máximo 100). */
    conversion: ConversionKpi
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
  /** Divisão do período atual entre pedido online e cupom confirmado. */
  channels: ChannelsBreakdown
  /** Até 10 ofertas mais lucrativas (compras confirmadas), por lucro. */
  topOffers: TopOffer[]
  /** Até 10 clientes que mais compraram (pedidos online + cupons confirmados), por valor gasto. */
  topCustomers: TopCustomer[]
}
