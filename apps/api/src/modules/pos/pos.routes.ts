import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import { posSaleSchema } from '../orders/orders.schema.js'
import type { OrdersService } from '../orders/orders.service.js'

// Modo PDV: venda de balcão. Histórico do dia: GET /orders?channel=POS.
export function posRouter(orders: OrdersService, requireLogin: RequestHandler) {
  const router = Router()

  router.post('/sales', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.status(201).json(await orders.createPosSale(req.user!, posSaleSchema.parse(req.body)))
  })

  return router
}
