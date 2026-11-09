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
  stockQty: number
  expirationDate: string | null // YYYY-MM-DD
}

// Visão do comerciante: inclui os campos da Rede B2B e o estado do cadastro.
export interface MerchantProductDTO extends ProductDTO {
  active: boolean
  barcode: string | null
  allowB2bSharing: boolean
  b2bReserveQty: number
  /** Bloqueio otimista: devolva este número no PUT; se mudou, a API responde 409 STALE_VERSION. */
  version: number
  createdAt: string
}
