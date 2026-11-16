export type OrderStatus = 'PENDING' | 'IN_PREPARATION' | 'READY' | 'COMPLETED' | 'CANCELLED'

export interface OrderItemDTO {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  flashOfferId: string | null // preenchido quando o item veio de uma oferta relâmpago
}

// Formato único de pedido: resposta HTTP e payload dos eventos `order:created` / `order:status_updated`.
export interface OrderDTO {
  id: string
  merchantId: string
  customer: { id: string; name: string } | null // null = venda de balcão (PDV)
  contact: {
    name: string | null
    phone: string | null
    deliveryMethod: string | null
    deliveryAddress: string | null
    paymentMethod: string | null
    notes: string | null
  }
  channel: 'ONLINE' | 'POS'
  status: OrderStatus
  totalPrice: number
  items: OrderItemDTO[]
  createdAt: string
  updatedAt: string
}
