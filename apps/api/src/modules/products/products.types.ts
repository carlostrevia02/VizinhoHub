// Produto como a vitrine enxerga (já com o preço final do Salva-Estoque).
export interface ProductDTO {
  id: string
  merchantId: string
  store: { name: string; neighborhood: string; city: string }
  category: { id: number; name: string }
  name: string
  description: string | null
  unit: string
  image: string | null
  price: number // preço de tabela
  effectivePrice: number // o que o cliente paga
  discountPct: number
  isClearance: boolean
  kind: 'ITEM' | 'COMBO' | 'DAILY_SPECIAL'
  leadTimeHours: number // 0 = pronta entrega; > 0 = encomenda (antecedência mínima)
  expirationDate: string | null // YYYY-MM-DD
}

// Visão do comerciante: inclui o estado do cadastro.
export interface MerchantProductDTO extends ProductDTO {
  active: boolean
  barcode: string | null
  /** Bloqueio otimista: devolva este número no PUT; se mudou, a API responde 409 STALE_VERSION. */
  version: number
  createdAt: string
}
