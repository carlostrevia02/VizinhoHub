import type { OrderDTO } from '../orders/orders.types.js'

export type PrintKind = 'TICKET' | 'KITCHEN' | 'RECEIPT'
export type PrintStatus = 'QUEUED' | 'SENT' | 'PRINTED' | 'FAILED'

// Job de impressão já com o pedido dentro: o caixa imprime sem outra chamada.
export interface PrintJobDTO {
  id: string
  orderId: string
  kind: PrintKind
  copyNo: number
  status: PrintStatus
  attempts: number
  createdAt: string
  order: OrderDTO
}

export const FUNNEL_EVENTS = ['STORE_VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_START'] as const
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number]

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}
