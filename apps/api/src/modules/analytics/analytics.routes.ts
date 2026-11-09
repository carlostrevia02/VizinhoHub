import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import { dashboardQuerySchema } from './analytics.schema.js'
import type { AnalyticsService } from './analytics.service.js'

// Dashboard Analítico do comerciante. Sempre da loja de quem está logado (o id vem do token, nunca da URL).
//
//   GET /api/v1/analytics/dashboard?startDate=2026-11-01&endDate=2026-11-07&status=valid
//
// status: "valid" (padrão, sem cancelados) | "all" | lista separada por vírgula (COMPLETED,READY)
export function analyticsRouter(service: AnalyticsService, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin, requireRole('MERCHANT'))

  router.get('/dashboard', async (req, res) => {
    const query = dashboardQuerySchema.parse(req.query)
    const payload = await service.dashboard(req.user!.id, query)
    // Dado privado da loja: o navegador pode reaproveitar por alguns segundos (trocar de aba/filtro), mais nada.
    res.set('Cache-Control', 'private, max-age=15')
    res.json(payload)
  })

  return router
}
