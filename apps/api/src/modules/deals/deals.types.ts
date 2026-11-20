import type { NearestBranchDTO } from '../branches/branches.types.js'
import type { CATEGORIES, UNITS } from './deals.schema.js'

export interface DealRow {
  id: string
  chain: { id: number; slug: string; name: string }
  neighborhood: string | null // null = oferta da rede toda
  productName: string
  category: (typeof CATEGORIES)[number]
  brand: string | null
  unit: (typeof UNITS)[number]
  wholesaleMinQty: number // 1 = varejo; N = o preço vale a partir de N unidades (atacarejo)
  originalPrice: number | null
  discountPrice: number
  discountPct: number | null
  isFlashDeal: boolean
  couponEligible: boolean
  deliveryEligible: boolean
  lastSeenAt: string
}

// Oferta como a API entrega: com ?lat=&lng= traz a filial mais próxima (por rota); sem coordenadas, null.
export interface DealDTO extends DealRow {
  nearestBranch: NearestBranchDTO | null
}

export interface ChainDTO {
  id: number
  slug: string
  name: string
  kind: 'RETAIL' | 'WHOLESALE'
  dealCount: number
}

export interface CouponDTO {
  id: string
  code: string
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' // EXPIRED também vale para ACTIVE já vencido
  productName: string
  unitPrice: number // "por": preço do encarte, o que o cliente paga
  originalPrice: number // "de": preço base no momento da reserva
  profit: number // (originalPrice - unitPrice) * minQty: o que a rede repassa ao VizinhoHub por cupom
  minQty: number
  chain: { slug: string; name: string }
  neighborhood: string | null
  createdAt: string
  expiresAt: string
  redeemedAt: string | null // quando o cliente confirmou a compra; null enquanto não confirmou
}

// Oferta já normalizada e pronta para gravar.
export interface ExtractedDeal {
  productName: string
  category: DealDTO['category']
  brand: string | null
  unit: DealDTO['unit']
  wholesaleMinQty: number
  originalPrice: number | null
  discountPrice: number
  discountPct: number | null
  isFlashDeal: boolean
  couponEligible: boolean
  deliveryEligible: boolean
  rawOfferText: string | null
}

export interface ExtractionResult {
  neighborhood: string | null
  deals: ExtractedDeal[]
  dropped: number // ofertas do modelo que não passaram na validação
}
