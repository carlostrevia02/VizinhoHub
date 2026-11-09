import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import { storeIdSchema, storeSettingsSchema } from './stores.schema.js'
import type { StoresService } from './stores.service.js'

export function storesRouter(service: StoresService, requireLogin: RequestHandler) {
  const router = Router()

  // Configurações da própria loja (declaradas antes de /:id).
  router.get('/me/settings', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.json(await service.getSettings(req.user!.id))
  })
  router.put('/me/settings', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.json(await service.saveSettings(req.user!.id, storeSettingsSchema.parse(req.body)))
  })

  // Pública: o checkout e a página da loja leem horários, entrega e pagamentos.
  router.get('/:id', async (req, res) => {
    res.json(await service.getPublic(storeIdSchema.parse(req.params).id))
  })

  return router
}
