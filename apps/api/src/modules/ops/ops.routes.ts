import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole, resolveUser } from '../../shared/auth.js'
import type { Db } from '../../shared/db.js'
import { rateLimit } from '../../shared/rate-limit.js'
import { idParam, printAckSchema, pushSubscribeSchema, pushUnsubscribeSchema, trackEventSchema } from './ops.schema.js'
import type { OpsService } from './ops.service.js'

// POST /events: telemetria da vitrine (público, anônimo, com limite por IP). Se vier token, grava o usuário.
export function eventsRouter(ops: OpsService, db: Db, jwtSecret: string) {
  const router = Router()
  router.post('/', rateLimit({ max: 240, windowMs: 60_000 }), async (req, res) => {
    const body = trackEventSchema.parse(req.body)
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
    const user = token ? await resolveUser(token, jwtSecret, db).catch(() => null) : null
    await ops.trackEvent({ ...body, userId: user?.id })
    res.status(204).end()
  })
  return router
}

// Fila de impressão do caixa (só o comerciante dono).
export function printRouter(ops: OpsService, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin, requireRole('MERCHANT'))

  router.get('/pending', async (req, res) => res.json(await ops.listPendingPrint(req.user!.id)))

  router.post('/:id/ack', async (req, res) => {
    await ops.ackPrint(req.user!.id, idParam.parse(req.params).id, printAckSchema.parse(req.body))
    res.status(204).end()
  })

  // Reimprimir a comanda de um pedido.
  router.post('/orders/:id/reprint', async (req, res) => {
    res.status(201).json({ id: await ops.reprint(req.user!.id, idParam.parse(req.params).id) })
  })
  return router
}

export function pushRouter(ops: OpsService, requireLogin: RequestHandler) {
  const router = Router()

  // Chave pública VAPID (sem login: o navegador precisa dela antes de pedir permissão).
  router.get('/key', (_req, res) => {
    const key = ops.publicKey()
    if (!key) {
      res.status(501).json({ error: { code: 'PUSH_NOT_CONFIGURED', message: 'Notificações push não estão configuradas neste servidor.' } })
      return
    }
    res.json({ publicKey: key })
  })

  router.post('/subscribe', requireLogin, async (req, res) => {
    const body = pushSubscribeSchema.parse(req.body)
    // Cliente nunca se inscreve nos avisos da loja; comerciante só como MERCHANT (ou COURIER se também for entregador).
    const isMerchant = req.user!.role === 'MERCHANT'
    const app = isMerchant ? (body.app === 'COURIER' ? 'COURIER' : 'MERCHANT') : body.app === 'MERCHANT' ? 'CUSTOMER' : body.app
    await ops.subscribe(req.user!.id, body, app, req.headers['user-agent'])
    res.status(204).end()
  })

  router.post('/unsubscribe', requireLogin, async (req, res) => {
    await ops.unsubscribe(req.user!.id, pushUnsubscribeSchema.parse(req.body).endpoint)
    res.status(204).end()
  })
  return router
}
