import express, { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import { AppError } from '../../shared/errors.js'
import { rateLimit } from '../../shared/rate-limit.js'
import { MAX_FLYER_BYTES, type FlyersService, uploadFlyerQuerySchema } from './deals.flyers.js'
import { idParamSchema, listDealsSchema } from './deals.schema.js'
import type { DealsService } from './deals.service.js'

// Vitrine pública de ofertas dos supermercados do bairro; o cupom exige login.
export function dealsRouter(service: DealsService, flyers: FlyersService, requireLogin: RequestHandler) {
  const router = Router()
  const uploadLimit = rateLimit({ max: 30, windowMs: 60 * 60 * 1000 })

  router.get('/', async (req, res) => {
    res.json(await service.list(listDealsSchema.parse(req.query)))
  })

  // Redes monitoradas com a quantidade de ofertas vigentes.
  router.get('/chains', async (_req, res) => {
    res.json(await service.chains())
  })

  // Encarte (PDF/JPEG/PNG/WebP) enviado por gerente/parceiro da rede: o corpo da requisição é o próprio arquivo
  // (Content-Type qualquer; o tipo real é conferido pelos bytes). Parâmetros na query: ?chain=sao-luiz&neighborhood=Aldeota.
  // Responde 202 na hora; acompanhe em GET /deals/flyers/:id.
  router.post(
    '/flyers',
    requireLogin,
    requireRole('MERCHANT'),
    uploadLimit,
    express.raw({ type: () => true, limit: MAX_FLYER_BYTES }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(400, 'FILE_REQUIRED', 'Envie o arquivo do encarte no corpo da requisição.')
      }
      res.status(202).json(await flyers.upload(req.user!, uploadFlyerQuerySchema.parse(req.query), req.body))
    },
  )

  router.get('/flyers', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.json(await flyers.listMine(req.user!))
  })

  router.get('/flyers/:id', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    res.json(await flyers.getMine(req.user!, idParamSchema.parse(req.params).id))
  })

  router.get('/:id', async (req, res) => {
    res.json(await service.get(idParamSchema.parse(req.params).id))
  })

  // Reserva a oferta: devolve o cupom (código para apresentar no caixa da rede, válido por 24 h).
  router.post('/:id/coupon', requireLogin, async (req, res) => {
    res.status(201).json(await service.claimCoupon(req.user!, idParamSchema.parse(req.params).id))
  })

  return router
}

export function couponsRouter(service: DealsService, requireLogin: RequestHandler) {
  const router = Router()
  router.get('/mine', requireLogin, async (req, res) => {
    res.json(await service.myCoupons(req.user!))
  })
  return router
}
