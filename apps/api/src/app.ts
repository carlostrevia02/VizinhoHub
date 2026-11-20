import { createServer } from 'node:http'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { addressesRouter } from './modules/addresses/addresses.routes.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { createAuthService } from './modules/auth/auth.service.js'
import { analyticsRouter } from './modules/analytics/analytics.routes.js'
import { createAnalyticsRepository } from './modules/analytics/analytics.repository.js'
import { createAnalyticsService } from './modules/analytics/analytics.service.js'
import { startCatalogLive } from './modules/catalog-live/catalog-live.js'
import { b2bRouter } from './modules/b2b/b2b.routes.js'
import { createB2bService } from './modules/b2b/b2b.service.js'
import { categoriesRouter } from './modules/categories/categories.routes.js'
import { createClaudeExtractor, type DealExtractor } from './modules/deals/deals.extractor.js'
import { createRouter, type Router } from './modules/branches/routing.js'
import { createFlyersService } from './modules/deals/deals.flyers.js'
import { couponsRouter, dealsRouter } from './modules/deals/deals.routes.js'
import { createDealsService } from './modules/deals/deals.service.js'
import { alertsRouter, flashRouter } from './modules/flash/flash.routes.js'
import { createFlashService } from './modules/flash/flash.service.js'
import { createPaymentProvider } from './modules/vip/payments/index.js'
import { createVipService } from './modules/vip/vip.service.js'
import { vipRouter } from './modules/vip/vip.routes.js'
import { socketDeliveryEvents } from './modules/delivery/delivery.events.js'
import { deliveryRouter } from './modules/delivery/delivery.routes.js'
import { createDeliveryService } from './modules/delivery/delivery.service.js'
import { creditRouter } from './modules/credit/credit.routes.js'
import { createCreditService } from './modules/credit/credit.service.js'
import { combosRouter, dailyMenuRouter } from './modules/daily-menu/daily-menu.routes.js'
import { createDailyMenuService } from './modules/daily-menu/daily-menu.service.js'
import { createSchedulingService } from './modules/scheduling/scheduling.service.js'
import { schedulingRouter } from './modules/scheduling/scheduling.routes.js'
import { createOpsService } from './modules/ops/ops.service.js'
import { eventsRouter, printRouter, pushRouter } from './modules/ops/ops.routes.js'
import { createOrdersService } from './modules/orders/orders.service.js'
import { ordersRouter } from './modules/orders/orders.routes.js'
import { reportsRouter } from './modules/reports/reports.routes.js'
import { smartCartRouter } from './modules/smart-cart/smart-cart.routes.js'
import { createSmartCartService } from './modules/smart-cart/smart-cart.service.js'
import { createStoresService } from './modules/stores/stores.service.js'
import { storesRouter } from './modules/stores/stores.routes.js'
import { posRouter } from './modules/pos/pos.routes.js'
import { createProductsService } from './modules/products/products.service.js'
import { productsRouter } from './modules/products/products.routes.js'
import { mountApiDocs } from './docs/serve.js'
import { authenticate } from './shared/auth.js'
import type { Db } from './shared/db.js'
import { corsOrigins, type Env } from './shared/env.js'
import { errorHandler, notFoundHandler } from './shared/errors.js'
import { createFirebaseVerifier, type FirebaseVerifier } from './shared/firebase.js'
import { createRealtime, merchantRoom, socketOrderEvents } from './shared/realtime.js'

// Monta HTTP + WebSocket sobre o mesmo servidor. Não chama listen(): quem decide é server.ts (ou o teste).
// `firebase`, `extractor` e `router` podem ser injetados (testes); por padrão vêm de FIREBASE_PROJECT_ID, ANTHROPIC_API_KEY e OSRM_URL.
export function buildServer(env: Env, db: Db, opts: { firebase?: FirebaseVerifier; extractor?: DealExtractor; router?: Router } = {}) {
  const app = express()
  app.disable('x-powered-by')
  const httpServer = createServer(app)
  const io = createRealtime(httpServer, { db, jwtSecret: env.JWT_SECRET, corsOrigins: corsOrigins(env) })
  // Vitrine em tempo real: LISTEN no Postgres → namespace público /catalog (parado em catalogLive.stop()).
  const catalogLive = startCatalogLive(io, { connectionString: env.DATABASE_URL })

  const firebase = opts.firebase ?? (env.FIREBASE_PROJECT_ID ? createFirebaseVerifier(env.FIREBASE_PROJECT_ID) : undefined)
  const requireLogin = authenticate(env.JWT_SECRET, db)

  const auth = createAuthService({ db, jwtSecret: env.JWT_SECRET, firebase })
  const products = createProductsService({ db })
  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : undefined
  const ops = createOpsService({ db, vapid, onPrintJob: (merchantId, job) => void io.to(merchantRoom(merchantId)).emit('print:job', job) })
  const flash = createFlashService({ db, ops })
  const vip = createVipService({ db, provider: createPaymentProvider(env), allowDevPay: env.NODE_ENV !== 'production' })
  const delivery = createDeliveryService({ db, events: socketDeliveryEvents(io), orderEvents: socketOrderEvents(io) })
  const credit = createCreditService({ db })
  const scheduling = createSchedulingService({ db })
  const dailyMenu = createDailyMenuService({ db })
  const orders = createOrdersService({ db, events: socketOrderEvents(io), ops })
  const b2b = createB2bService({ db })
  const stores = createStoresService({ db })
  // Rota até a filial mais próxima (ofertas com ?lat=&lng=): OSRM público por padrão, OSRM_URL aponta para um próprio.
  const router = opts.router ?? createRouter({ baseUrl: env.OSRM_URL })
  const deals = createDealsService({ db, router })
  const extractor = opts.extractor ?? (env.ANTHROPIC_API_KEY ? createClaudeExtractor({ apiKey: env.ANTHROPIC_API_KEY, model: env.DEALS_MODEL }) : undefined)
  const flyers = createFlyersService({ db, extract: extractor })
  const smartCart = createSmartCartService({ db })

  // gzip: o catálogo inteiro (~1,4 MB de JSON) cai para ~10% na rede.
  app.use(compression())
  app.use(cors({ origin: corsOrigins(env) }))
  // 100 KB para a API toda; só o encarte estruturado (até 200 ofertas) tem parser próprio, de 1 MB, na própria rota.
  const json100kb = express.json({ limit: '100kb' })
  app.use((req, res, next) => (/^/api(/v1)?/deals/flyers/structured/?$/.test(req.path) ? next() : json100kb(req, res, next)))

  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1')
    res.json({ status: 'ok' })
  })

  // Contrato: base /api/v1. `/api` continua valendo (compatibilidade).
  const api = express.Router()
  api.use('/auth', authRouter(auth, requireLogin))
  api.use('/categories', categoriesRouter(db, requireLogin))
  api.use('/products', productsRouter(products, requireLogin))
  api.use('/orders', requireLogin, ordersRouter(orders))
  api.use('/pos', posRouter(orders, requireLogin))
  api.use('/b2b', b2bRouter(b2b, requireLogin))
  api.use('/stores', storesRouter(stores, requireLogin))
  api.use('/me/addresses', addressesRouter(db, requireLogin))
  api.use('/reports', reportsRouter(db, requireLogin))
  api.use('/analytics', analyticsRouter(createAnalyticsService(createAnalyticsRepository(db)), requireLogin))
  api.use('/events', eventsRouter(ops, db, env.JWT_SECRET))
  api.use('/print-jobs', printRouter(ops, requireLogin))
  api.use('/push', pushRouter(ops, requireLogin))
  api.use('/deals', dealsRouter(deals, flyers, requireLogin))
  api.use('/coupons', couponsRouter(deals, requireLogin))
  api.use('/flash', flashRouter(flash, requireLogin))
  api.use('/me/alerts', alertsRouter(flash, requireLogin))
  api.use('/vip', vipRouter(vip, requireLogin))
  api.use('/delivery', deliveryRouter(delivery, requireLogin))
  api.use('/credit', creditRouter(credit, requireLogin))
  api.use('/scheduling', schedulingRouter(scheduling, requireLogin))
  api.use('/daily-menu', dailyMenuRouter(dailyMenu, requireLogin))
  api.use('/combos', combosRouter(dailyMenu, requireLogin))
  api.use('/smart-cart', smartCartRouter(smartCart, requireLogin))
  app.use(['/api/v1', '/api'], api)

  // Documentação (Swagger UI + openapi.json), antes do 404. Desligável com API_DOCS=false.
  if (env.API_DOCS) mountApiDocs(app)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return { app, httpServer, io, catalogLive, flyers, ops, flash, vip, delivery }
}
