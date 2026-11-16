import { z } from 'zod'

export const ORDER_STATUSES = ['PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED', 'CANCELLED'] as const
const orderStatus = z.enum(ORDER_STATUSES)

export const orderItemsSchema = z
  .array(
    z.object({
      productId: z.uuid(),
      quantity: z.number().int().min(1).max(99),
    }),
  )
  .min(1, 'O pedido precisa de pelo menos 1 item.')
  .max(50, 'Máximo de 50 itens por pedido.')

// Item do pedido online: produto comum OU oferta relâmpago (exatamente um dos dois ids).
export const onlineOrderItemsSchema = z
  .array(
    z
      .object({
        productId: z.uuid().optional(),
        flashOfferId: z.uuid().optional(),
        quantity: z.number().int().min(1).max(99),
      })
      .refine((i) => Boolean(i.productId) !== Boolean(i.flashOfferId), 'Informe productId ou flashOfferId (exatamente um).'),
  )
  .min(1, 'O pedido precisa de pelo menos 1 item.')
  .max(50, 'Máximo de 50 itens por pedido.')

export const createOrderSchema = z.object({
  items: onlineOrderItemsSchema,
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
export const orderIdSchema = z.object({ id: z.uuid() })
