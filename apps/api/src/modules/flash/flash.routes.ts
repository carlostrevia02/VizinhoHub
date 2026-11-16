import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import { alertSchema, createFlashSchema, idParam, radarQuerySchema } from './flash.schema.js'
import type { FlashService } from './flash.service.js'

// Tá Quentinho: ofertas relâmpago geolocalizadas.
export function flashRouter(service: FlashService, requireLogin: RequestHandler) {
  const router = Router()

  // Público: o radar não exige login (só a compra exige).
  router.get('/radar', async (req, res) => {
    res.json(await service.radar(radarQuerySchema.parse(req.query)))
  })

  // Lojista
  router.get('/mine', requireLogin, requireRole('MERCHANT'), async (req, res) => res.json(await service.listMine(req.user!.id)))
  router.post('/', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.status(201).json(await service.create(req.user!.id, createFlashSchema.parse(req.body)))
  })
  router.post('/:id/cancel', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    await service.cancel(req.user!.id, idParam.parse(req.params).id)
    res.status(204).end()
  })
  return router
}

// Alertas "perto de casa" do cliente (/me/alerts).
export function alertsRouter(service: FlashService, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin)
  router.get('/', async (req, res) => res.json(await service.listAlerts(req.user!.id)))
  router.post('/', async (req, res) => res.status(201).json(await service.addAlert(req.user!.id, alertSchema.parse(req.body))))
  router.delete('/:id', async (req, res) => {
    await service.removeAlert(req.user!.id, idParam.parse(req.params).id)
    res.status(204).end()
  })
  return router
}
