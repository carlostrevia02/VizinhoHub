import type { CourierLocationDTO, DeliveryOfferDTO } from './delivery.js'
import type { FlashOfferDTO } from './flash.js'
import type { PrintJobDTO } from './ops.js'
import type { OrderDTO } from './orders.js'

// Contrato do Socket.io (espelha apps/api/src/shared/realtime.ts).

// Salas. O servidor coloca o usuário na sala do próprio papel ao conectar.
export const merchantRoom = (merchantId: string) => `merchant:${merchantId}`
export const customerRoom = (customerId: string) => `customer:${customerId}`
// previsto (roadmap): rastreamento por corrida e convites do pool por entregador
export const deliveryRoom = (deliveryId: string) => `delivery:${deliveryId}`
export const courierRoom = (courierId: string) => `courier:${courierId}`

export const SOCKET_EVENTS = {
  orderCreated: 'order:created',
  orderStatusUpdated: 'order:status_updated',
  printJob: 'print:job',
  deliveryOffered: 'delivery:offered', // previsto (roadmap)
  deliveryLocation: 'delivery:location', // previsto (roadmap)
  offerNew: 'offer:new', // previsto (roadmap)
} as const

// Eventos que o servidor emite, com o payload de cada um.
export interface ServerToClientEvents {
  'order:created': (order: OrderDTO) => void
  'order:status_updated': (order: OrderDTO) => void
  'print:job': (job: PrintJobDTO) => void
  // previsto (roadmap)
  'delivery:offered': (offer: DeliveryOfferDTO) => void
  // previsto (roadmap)
  'delivery:location': (point: CourierLocationDTO) => void
  // previsto (roadmap)
  'offer:new': (offer: FlashOfferDTO) => void
}
// Hoje o cliente não emite nada pelo socket.
export type ClientToServerEvents = Record<string, never>

export type SocketEventName = keyof ServerToClientEvents
export type SocketPayload<E extends SocketEventName> = Parameters<ServerToClientEvents[E]>[0]
