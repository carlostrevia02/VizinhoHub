import { z } from 'zod'

// Copiado de apps/api/src/modules/orders (a fonte da verdade continua sendo a API por enquanto).

export const ORDER_STATUSES = ['PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED', 'CANCELLED'] as const
export const orderStatus = z.enum(ORDER_STATUSES)
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const orderItemsSchema = z
  .array(
    z.object({
      productId: z.uuid(),
      quantity: z.number().int().min(1).max(99),
    }),
  )
  .min(1, 'O pedido precisa de pelo menos 1 item.')
  .max(50, 'Máximo de 50 itens por pedido.')

export const createOrderSchema = z.object({
  items: orderItemsSchema,
  // Dados do checkout (opcionais).
  customerName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  deliveryMethod: z.string().trim().min(1).max(60).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
  deliveryAddress: z.string().trim().min(3).max(300).optional(),
  // Precisa estar ativa nas configurações da loja.
  paymentMethod: z.enum(['pix', 'card', 'cash']).optional(),
})
export type CreateOrderInput = z.infer<typeof createOrderSchema>

// Venda de balcão (Modo PDV): só os itens.
export const posSaleSchema = z.object({ items: orderItemsSchema })
export type PosSaleInput = z.infer<typeof posSaleSchema>

export const listOrdersSchema = z.object({
  status: orderStatus.optional(),
  channel: z.enum(['ONLINE', 'POS']).optional(),
  // true = pedidos em andamento (Kanban): tudo que não terminou nem foi cancelado.
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
export type ListOrdersQuery = z.infer<typeof listOrdersSchema>

export const updateStatusSchema = z.object({ status: orderStatus })
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>
export const orderIdSchema = z.object({ id: z.uuid() })

// Dinheiro nos DTOs é `number` (a API converte o NUMERIC antes de responder).
export interface OrderItemDTO {
  productId: string
  name: string
  quantity: number
  unitPrice: number
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
