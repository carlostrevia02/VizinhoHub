import { Router } from 'express'
import { requireRole } from '../../shared/auth.js'
import { createOrderSchema, listOrdersSchema, orderIdSchema, updateStatusSchema } from './orders.schema.js'
import type { OrdersService } from './orders.service.js'

export function ordersRouter(service: OrdersService) {
  const router = Router()

  // Cliente finaliza o carrinho → 201 + evento `order:created` para o painel do mercadinho.
  router.post('/', requireRole('CUSTOMER'), async (req, res) => {
    const order = await service.createOrder(req.user!, createOrderSchema.parse(req.body))
    res.status(201).json(order)
  })

  // Comerciante: pedidos da loja (carga inicial do Kanban: ?active=true). Cliente: os próprios pedidos.
  router.get('/', async (req, res) => {
    res.json(await service.listOrders(req.user!, listOrdersSchema.parse(req.query)))
  })

  router.get('/:id', async (req, res) => {
    res.json(await service.getOrder(req.user!, orderIdSchema.parse(req.params).id))
  })

  // Kanban: PENDING → IN_PREPARATION → READY → COMPLETED (ou CANCELLED). Emite `order:status_updated`.
  router.patch('/:id/status', requireRole('MERCHANT'), async (req, res) => {
    const { id } = orderIdSchema.parse(req.params)
    res.json(await service.updateStatus(req.user!, id, updateStatusSchema.parse(req.body).status))
  })

  return router
}
