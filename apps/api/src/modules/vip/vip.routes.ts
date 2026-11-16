import { cancelVipSchema, subscribeVipSchema, vipMerchantSettingsSchema } from '@vizinhohub/contracts/vip'
import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { requireRole } from '../../shared/auth.js'
import type { VipService } from './vip.service.js'

const invoiceParam = z.object({ id: z.uuid() })

export function vipRouter(service: VipService, requireLogin: RequestHandler) {
  const router = Router()

  // Público: planos e faixas de desconto.
  router.get('/plans', async (_req, res) => res.json(await service.listPlans()))

  // Webhook do provedor: SEM login; a autenticidade é o token/segredo do header (verificado pelo adapter).
  // Não precisa do corpo cru (não há HMAC), então segue no express.json() global.
  router.post('/webhooks/:provider', async (req, res) => {
    res.json(await service.handleWebhook(String(req.params.provider), req.headers, req.body))
  })

  // Cliente
  router.get('/me', requireLogin, async (req, res) => res.json(await service.me(req.user!.id)))
  // Desconto que o cliente terá numa loja (0 se não for VIP ou a loja não aderiu).
  router.get('/discount/:merchantId', requireLogin, async (req, res) => res.json(await service.discountAt(req.user!.id, z.object({ merchantId: z.uuid() }).parse(req.params).merchantId)))
  router.get('/invoices', requireLogin, async (req, res) => res.json(await service.invoices(req.user!.id)))
  router.post('/subscribe', requireLogin, requireRole('CUSTOMER'), async (req, res) => {
    res.status(201).json(await service.subscribe(req.user!.id, subscribeVipSchema.parse(req.body)))
  })
  router.post('/cancel', requireLogin, requireRole('CUSTOMER'), async (req, res) => {
    res.json(await service.cancel(req.user!.id, cancelVipSchema.parse(req.body ?? {})))
  })
  // Só existe com provedor mock fora de produção (o service responde 404 caso contrário).
  router.post('/dev/invoices/:id/pay', requireLogin, requireRole('CUSTOMER'), async (req, res) => {
    res.json(await service.simulatePayment(req.user!.id, invoiceParam.parse(req.params).id))
  })

  // Lojista
  router.get('/merchant', requireLogin, requireRole('MERCHANT'), async (req, res) => res.json(await service.merchantState(req.user!.id)))
  router.put('/merchant', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    await service.enroll(req.user!.id, vipMerchantSettingsSchema.parse(req.body))
    res.json(await service.merchantState(req.user!.id))
  })
  // Adesão sem corpo: usa os padrões (teto 10 %, plataforma banca o frete).
  router.post('/merchant', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    await service.enroll(req.user!.id, req.body && Object.keys(req.body).length ? vipMerchantSettingsSchema.parse(req.body) : {})
    res.status(201).json(await service.merchantState(req.user!.id))
  })
  router.delete('/merchant', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    await service.leave(req.user!.id)
    res.status(204).end()
  })

  return router
}
