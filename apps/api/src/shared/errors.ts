import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

// Erro de negócio com status HTTP e código estável (o frontend decide a mensagem pelo código).
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.' } })
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    })
    return
  }
  // JSON malformado / corpo grande demais (body-parser) → erro do cliente, não 500.
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' } })
    return
  }
  // Violações de integridade que escaparam da validação de negócio.
  if (err?.code === '23505') {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'Registro já existe.' } })
    return
  }
  if (err?.code === '23503') {
    res.status(422).json({ error: { code: 'INVALID_REFERENCE', message: 'Referência inexistente.' } })
    return
  }
  console.error(err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro inesperado.' } })
}
