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
  // Paginação com `limit` (até 200) e `offset`; o corpo continua sendo um array e o total sai em `X-Total-Count`.
  router.get('/', async (req, res) => {
    const query = listOrdersSchema.parse(req.query)
    const [orders, total] = await Promise.all([service.listOrders(req.user!, query), service.countOrders(req.user!, query)])
    res.set('X-Total-Count', String(total)).json(orders)
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
