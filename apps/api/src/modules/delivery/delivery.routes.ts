import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import {
  confirmPinSchema,
  courierLocationSchema,
  courierRegisterSchema,
  courierStatusSchema,
  failDeliverySchema,
  idParam,
  listDeliveriesSchema,
  merchantParam,
  orderParam,
  requestDeliverySchema,
  storeDeliveryConfigSchema,
} from './delivery.schema.js'
import type { DeliveryService } from './delivery.service.js'

// Logística: configuração da loja, chamado de entregador, rastreamento e área do entregador.
// Montado em /delivery. O entregador é um usuário comum (CUSTOMER) com perfil em `couriers`.
export function deliveryRouter(service: DeliveryService, requireLogin: RequestHandler) {
  const router = Router()
  const merchant = [requireLogin, requireRole('MERCHANT')]
  const courier = [requireLogin, requireRole('CUSTOMER')]

  // Pública: o checkout lê taxa e raio da loja.
  router.get('/stores/:merchantId', async (req, res) => {
    res.json(await service.getPublicConfig(merchantParam.parse(req.params).merchantId))
  })

  // ---- lojista --------------------------------------------------------------------------------------
  router.get('/config', ...merchant, async (req, res) => res.json(await service.getConfig(req.user!.id)))
  router.put('/config', ...merchant, async (req, res) => {
    res.json(await service.saveConfig(req.user!.id, storeDeliveryConfigSchema.parse(req.body)))
  })
  router.get('/orders', ...merchant, async (req, res) => res.json(await service.listMerchantOrders(req.user!.id)))
  router.get('/deliveries', ...merchant, async (req, res) => {
    const q = listDeliveriesSchema.parse(req.query)
    res.json(await service.listMine(req.user!.id, q.status ?? null, q.limit))
  })
  router.post('/deliveries', ...merchant, async (req, res) => {
    res.status(201).json(await service.requestDelivery(req.user!.id, requestDeliverySchema.parse(req.body)))
  })
  router.post('/deliveries/:id/unlock-pin', ...merchant, async (req, res) => {
    res.json(await service.unlockPin(req.user!.id, idParam.parse(req.params).id))
  })

  // ---- cliente (e lojista): a entrega de um pedido -----------------------------------------------------
  router.get('/orders/:orderId', requireLogin, async (req, res) => {
    res.json(await service.trackOrder(req.user!, orderParam.parse(req.params).orderId))
  })

  // ---- entregador -----------------------------------------------------------------------------------
  router.get('/courier', ...courier, async (req, res) => res.json(await service.getCourier(req.user!.id)))
  router.post('/courier', ...courier, async (req, res) => {
    res.status(201).json(await service.registerCourier(req.user!.id, courierRegisterSchema.parse(req.body)))
  })
  router.put('/courier/status', ...courier, async (req, res) => {
    res.json(await service.setCourierStatus(req.user!.id, courierStatusSchema.parse(req.body).status))
  })
  router.get('/courier/offers', ...courier, async (req, res) => res.json(await service.listOffers(req.user!.id)))
  router.get('/courier/active', ...courier, async (req, res) => res.json(await service.activeDelivery(req.user!.id)))
  router.post('/courier/deliveries/:id/accept', ...courier, async (req, res) => {
    res.json(await service.acceptOffer(req.user!.id, idParam.parse(req.params).id))
  })
  router.post('/courier/deliveries/:id/decline', ...courier, async (req, res) => {
    await service.declineOffer(req.user!.id, idParam.parse(req.params).id)
    res.status(204).end()
  })
  router.put('/courier/location', ...courier, async (req, res) => {
    res.json(await service.reportLocation(req.user!.id, courierLocationSchema.parse(req.body)))
  })
  router.post('/courier/deliveries/:id/pickup', ...courier, async (req, res) => {
    res.json(await service.markPickedUp(req.user!.id, idParam.parse(req.params).id))
  })
  router.post('/courier/deliveries/:id/deliver', ...courier, async (req, res) => {
    res.json(await service.confirmPin(req.user!.id, idParam.parse(req.params).id, confirmPinSchema.parse(req.body).pin))
  })
  router.post('/courier/deliveries/:id/fail', ...courier, async (req, res) => {
    res.json(await service.failDelivery(req.user!.id, idParam.parse(req.params).id, failDeliverySchema.parse(req.body).reason))
  })

  return router
}
