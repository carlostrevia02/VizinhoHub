import { idParam } from '@vizinhohub/contracts/common'
import { createPickupSlotSchema, leadTimeSchema, listScheduledOrdersSchema, slotAvailabilityQuerySchema, updatePickupSlotSchema } from '@vizinhohub/contracts/scheduling'
import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import type { SchedulingService } from './scheduling.service.js'

// Encomendas e agenda de retirada. O agendamento do pedido em si vai no POST /orders (campo `schedule`).
export function schedulingRouter(service: SchedulingService, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin)
  const merchant = requireRole('MERCHANT')

  // Vagas livres de uma loja (o checkout do cliente).
  router.get('/availability', async (req, res) => res.json(await service.availability(slotAvailabilityQuerySchema.parse(req.query))))

  // Lojista: faixas, agenda e produtos sob encomenda.
  router.get('/slots', merchant, async (req, res) => res.json(await service.listSlots(req.user!)))
  router.post('/slots', merchant, async (req, res) => res.status(201).json(await service.createSlot(req.user!, createPickupSlotSchema.parse(req.body))))
  router.patch('/slots/:id', merchant, async (req, res) => {
    // O schema parcial preenche o `default(true)` de `active`: só vale o que veio no corpo.
    const parsed = updatePickupSlotSchema.parse(req.body)
    const sent = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in req.body))
    res.json(await service.updateSlot(req.user!, idParam.parse(req.params).id, sent))
  })
  router.delete('/slots/:id', merchant, async (req, res) => res.json({ result: await service.removeSlot(req.user!, idParam.parse(req.params).id) }))
  router.get('/orders', merchant, async (req, res) => res.json(await service.scheduledOrders(req.user!, listScheduledOrdersSchema.parse(req.query))))
  router.patch('/products/:id/lead-time', merchant, async (req, res) => {
    res.json(await service.setLeadTime(req.user!, idParam.parse(req.params).id, leadTimeSchema.parse(req.body).leadTimeHours))
  })

  return router
}
