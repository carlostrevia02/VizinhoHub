import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import type { CourierLocationDTO, DeliveryOfferDTO } from '@vizinhohub/contracts/delivery'
import type { PrintJobDTO } from '../modules/ops/ops.types.js'
import type { OrderDTO } from '../modules/orders/orders.types.js'
import type { AuthUser } from './auth.js'
import { resolveUser } from './auth.js'
import type { Db } from './db.js'

// Contrato dos eventos (compartilhável com o frontend).
export interface ServerToClientEvents {
  'order:created': (order: OrderDTO) => void
  'order:status_updated': (order: OrderDTO) => void
  'print:job': (job: PrintJobDTO) => void
  // 004 logística
  'delivery:offered': (offer: DeliveryOfferDTO) => void
  'delivery:location': (point: CourierLocationDTO) => void
}
export type ClientToServerEvents = Record<string, never>
interface SocketData {
  user: AuthUser
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

// Cada comerciante escuta só a própria sala; cada cliente, a sua.
export const merchantRoom = (merchantId: string) => `merchant:${merchantId}`
export const customerRoom = (customerId: string) => `customer:${customerId}`
// 004 logística: convites do pool por entregador e rastreio por corrida
export const courierRoom = (courierId: string) => `courier:${courierId}`
export const deliveryRoom = (deliveryId: string) => `delivery:${deliveryId}`

export function createRealtime(httpServer: HttpServer, opts: { db: Db; jwtSecret: string; corsOrigins: string[] }): RealtimeServer {
  const io: RealtimeServer = new Server(httpServer, { cors: { origin: opts.corsOrigins } })

  // Autentica no handshake: io('http://api', { auth: { token } }).
  io.use(async (socket, next) => {
    try {
      socket.data.user = await resolveUser(socket.handshake.auth?.token, opts.jwtSecret, opts.db)
      next()
    } catch (err) {
      next(err instanceof Error ? err : new Error('UNAUTHENTICATED'))
    }
  })

  io.on('connection', (socket) => {
    const { user } = socket.data
    void socket.join(user.role === 'MERCHANT' ? merchantRoom(user.id) : customerRoom(user.id))
    // 004 logística: convites (todo usuário pode ser entregador) e entregas em andamento do próprio usuário.
    void socket.join(courierRoom(user.id))
    void opts.db
      .query<{ id: string }>(
        `SELECT d.id FROM deliveries d JOIN orders o ON o.id = d.order_id
          WHERE d.status IN ('REQUESTED', 'OFFERED', 'ACCEPTED', 'PICKED_UP') AND (o.customer_id = $1 OR d.merchant_id = $1)`,
        [user.id],
      )
      .then(({ rows }) => void socket.join(rows.map((r) => deliveryRoom(r.id))))
      .catch(() => {})
  })

  return io
}

// Ponte entre o caso de uso e o transporte: o service não conhece Socket.io.
export interface OrderEvents {
  orderCreated(order: OrderDTO): void
  orderStatusUpdated(order: OrderDTO): void
}

export const socketOrderEvents = (io: RealtimeServer): OrderEvents => ({
  orderCreated: (order) => io.to(merchantRoom(order.merchantId)).emit('order:created', order),
  // O cliente acompanha o pedido; os outros dispositivos da loja mantêm o Kanban sincronizado.
  orderStatusUpdated: (order) => {
    const rooms = [merchantRoom(order.merchantId)]
    if (order.customer) rooms.push(customerRoom(order.customer.id))
    io.to(rooms).emit('order:status_updated', order)
  },
})
