import { idParam } from '@vizinhohub/contracts/common'
import { createComboSchema, dailyMenuQuerySchema, setDailyMenuSchema, updateDailyMenuSchema } from '@vizinhohub/contracts/daily-menu'
import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { requireRole } from '../../shared/auth.js'
import type { DailyMenuService } from './daily-menu.service.js'

// Prato do dia: a vitrine lê sem login; o lojista gerencia.
export function dailyMenuRouter(service: DailyMenuService, requireLogin: RequestHandler) {
  const router = Router()
  const merchant = [requireLogin, requireRole('MERCHANT')]

  router.get('/', async (req, res) => res.json(await service.listPublic(dailyMenuQuerySchema.parse(req.query))))
  router.get('/mine', ...merchant, async (req, res) => res.json(await service.listMine(req.user!, dailyMenuQuerySchema.parse(req.query).date)))
  router.put('/', ...merchant, async (req, res) => res.json(await service.setMenu(req.user!, setDailyMenuSchema.parse(req.body))))
  router.patch('/:id', ...merchant, async (req, res) => {
    res.json(await service.updateMenu(req.user!, idParam.parse(req.params).id, updateDailyMenuSchema.parse(req.body)))
  })
  return router
}

export const combosQuery = z.object({ merchantId: z.uuid().optional() })

// Combos: a vitrine lê sem login; o lojista cadastra.
export function combosRouter(service: DailyMenuService, requireLogin: RequestHandler) {
  const router = Router()
  const merchant = [requireLogin, requireRole('MERCHANT')]

  router.get('/', async (req, res) => res.json(await service.listCombos(combosQuery.parse(req.query).merchantId)))
  router.get('/mine', ...merchant, async (req, res) => res.json(await service.listCombos(req.user!.id)))
  router.post('/', ...merchant, async (req, res) => res.status(201).json(await service.createCombo(req.user!, createComboSchema.parse(req.body))))
  router.delete('/:id', ...merchant, async (req, res) => {
    await service.removeCombo(req.user!, idParam.parse(req.params).id)
    res.status(204).end()
  })
  return router
}
