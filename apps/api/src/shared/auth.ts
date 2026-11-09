import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Db } from './db.js'
import { AppError } from './errors.js'

export type Role = 'MERCHANT' | 'CUSTOMER'
export interface AuthUser {
  id: string
  name: string
  role: Role
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

// Token da API: JWT HS256 com sub = users.id. (Próximo passo: aceitar o ID token do
// Firebase Auth e mapear por users.firebase_uid — só esta função muda.)
export function signToken(userId: string, secret: string, expiresIn: jwt.SignOptions['expiresIn'] = '7d') {
  return jwt.sign({}, secret, { subject: userId, expiresIn, algorithm: 'HS256' })
}

// Valida o token e carrega o usuário do banco: o papel vem do banco, nunca do token.
export async function resolveUser(token: string | undefined, secret: string, db: Db): Promise<AuthUser> {
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar.')
  let sub: string | undefined
  try {
    sub = jwt.verify(token, secret, { algorithms: ['HS256'] }).sub as string | undefined
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Sessão inválida ou expirada.')
  }
  const { rows } = await db.query<AuthUser>('SELECT id, name, role FROM users WHERE id = $1', [sub])
  const user = rows[0]
  if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Usuário não encontrado.')
  return user
}

const bearer = (req: Request) => req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]

export const authenticate =
  (secret: string, db: Db) => async (req: Request, _res: Response, next: NextFunction) => {
    req.user = await resolveUser(bearer(req), secret, db)
    next()
  }

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.')
    }
    next()
  }
