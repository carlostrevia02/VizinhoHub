import { courierRoom, customerRoom, deliveryRoom, merchantRoom, type RealtimeServer } from '../../shared/realtime.js'
import type { DeliveryEvents } from './delivery.service.js'

// Transporte Socket.io dos eventos de logística. Salas: `courier:<id>` (convites) e `delivery:<id>` (rastreio).
export const socketDeliveryEvents = (io: RealtimeServer): DeliveryEvents => ({
  offered: (courierId, offer) => void io.to(courierRoom(courierId)).emit('delivery:offered', offer),
  location: (point) => void io.to(deliveryRoom(point.deliveryId)).emit('delivery:location', point),
  created: (deliveryId, merchantId, customerId) => {
    // Quem já está conectado entra na sala agora; quem conectar depois entra pelo handshake (realtime.ts).
    io.in(merchantRoom(merchantId)).socketsJoin(deliveryRoom(deliveryId))
    if (customerId) io.in(customerRoom(customerId)).socketsJoin(deliveryRoom(deliveryId))
  },
})
