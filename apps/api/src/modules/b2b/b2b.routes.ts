import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import { type B2bService, searchSchema } from './b2b.service.js'

// Toda a Rede B2B é restrita a comerciantes. Para entrar na rede, o produto precisa de
// `allowB2bSharing: true` e `barcode` (PUT /products/:id); `b2bReserveQty` é o que a loja não oferece.
export function b2bRouter(service: B2bService, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin, requireRole('MERCHANT'))

  // Quem perto de mim tem esse item sobrando? (?barcode= ou ?productId=, &radiusKm=)
  router.get('/search', async (req, res) => {
    res.json(await service.search(req.user!, searchSchema.parse(req.query)))
  })

  // Meus esgotados que a vizinhança consegue suprir.
  router.get('/alerts', async (req, res) => {
    res.json(await service.alerts(req.user!))
  })

  return router
}
