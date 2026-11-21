import { adjustmentSchema, createCreditAccountSchema, listCreditAccountsSchema, listCreditCandidatesSchema, registerPaymentSchema, updateCreditAccountSchema } from '@vizinhohub/contracts/credit'
import { idParam } from '@vizinhohub/contracts/common'
import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { requireRole } from '../../shared/auth.js'
import type { CreditService } from './credit.service.js'

export const ledgerQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })

// Caderneta (fiado). Todas as rotas exigem login; o lojista gerencia, o cliente só consulta.
export function creditRouter(service: CreditService, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin)
  const merchant = requireRole('MERCHANT')

  // Cliente: as próprias contas (uma por loja).
  router.get('/mine', requireRole('CUSTOMER'), async (req, res) => res.json(await service.listMine(req.user!)))

  // Lojista
  router.get('/accounts', merchant, async (req, res) => res.json(await service.listForMerchant(req.user!, listCreditAccountsSchema.parse(req.query))))
  router.get('/candidates', merchant, async (req, res) => res.json(await service.candidates(req.user!, listCreditCandidatesSchema.parse(req.query))))
  router.post('/accounts', merchant, async (req, res) => res.status(201).json(await service.createAccount(req.user!, createCreditAccountSchema.parse(req.body))))
  router.patch('/accounts/:id', merchant, async (req, res) => {
    res.json(await service.updateAccount(req.user!, idParam.parse(req.params).id, updateCreditAccountSchema.parse(req.body)))
  })
  router.post('/accounts/:id/payments', merchant, async (req, res) => {
    res.status(201).json(await service.pay(req.user!, idParam.parse(req.params).id, registerPaymentSchema.parse(req.body)))
  })
  router.post('/accounts/:id/adjustments', merchant, async (req, res) => {
    res.status(201).json(await service.adjust(req.user!, idParam.parse(req.params).id, adjustmentSchema.parse(req.body)))
  })
  router.post('/accounts/:id/reminder', merchant, async (req, res) => res.json(await service.reminder(req.user!, idParam.parse(req.params).id)))

  // Extrato: lojista da conta ou cliente dono (o serviço confere).
  router.get('/accounts/:id/ledger', async (req, res) => {
    res.json(await service.ledgerOf(req.user!, idParam.parse(req.params).id, ledgerQuery.parse(req.query).limit))
  })

  return router
}
