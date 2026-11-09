import { Router } from 'express'
import type { RequestHandler } from 'express'
import { rateLimit } from '../../shared/rate-limit.js'
import { becomeMerchantSchema, firebaseLoginSchema, loginSchema, registerSchema, updateMeSchema } from './auth.schema.js'
import type { AuthService } from './auth.service.js'

export function authRouter(service: AuthService, requireLogin: RequestHandler) {
  const router = Router()
  const limit = rateLimit({ max: 20, windowMs: 15 * 60 * 1000 })

  router.post('/register', limit, async (req, res) => {
    res.status(201).json(await service.register(registerSchema.parse(req.body)))
  })

  router.post('/login', limit, async (req, res) => {
    res.json(await service.login(loginSchema.parse(req.body)))
  })

  // Frontend com Firebase Auth: manda o ID token e recebe o token da API.
  router.post('/firebase', limit, async (req, res) => {
    res.json(await service.loginWithFirebase(firebaseLoginSchema.parse(req.body)))
  })

  router.get('/me', requireLogin, async (req, res) => {
    res.json(await service.me(req.user!))
  })

  router.patch('/me', requireLogin, async (req, res) => {
    res.json(await service.updateMe(req.user!, updateMeSchema.parse(req.body)))
  })

  router.post('/become-merchant', requireLogin, limit, async (req, res) => {
    res.json(await service.becomeMerchant(req.user!, becomeMerchantSchema.parse(req.body)))
  })

  return router
}
