import type { RequestHandler } from 'express'
import { AppError } from './errors.js'

// Janela fixa em memória (suficiente para uma instância só): freia tentativa de senha por força bruta.
export function rateLimit(opts: { max: number; windowMs: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return (req, _res, next) => {
    const now = Date.now()
    const key = req.ip ?? 'unknown'
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs }
      hits.set(key, entry)
      // Limpeza oportunista para o mapa não crescer sem fim.
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    }
    if (++entry.count > opts.max) {
      throw new AppError(429, 'TOO_MANY_REQUESTS', 'Muitas tentativas. Aguarde alguns minutos.')
    }
    next()
  }
}
