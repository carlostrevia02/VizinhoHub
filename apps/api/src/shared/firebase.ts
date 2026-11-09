import jwt from 'jsonwebtoken'
import { AppError } from './errors.js'

export interface FirebaseIdentity {
  uid: string
  email?: string
  emailVerified: boolean
  name?: string
}
export type FirebaseVerifier = (idToken: string) => Promise<FirebaseIdentity>

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

// Valida o ID token do Firebase Auth sem service account: assinatura RS256 contra os
// certificados públicos do Google + audience/issuer do projeto (mesmo que o firebase-admin faz).
export function createFirebaseVerifier(projectId: string): FirebaseVerifier {
  let certs: Record<string, string> = {}
  let expiresAt = 0

  async function loadCerts(force = false) {
    if (!force && Date.now() < expiresAt) return certs
    const res = await fetch(CERTS_URL)
    if (!res.ok) throw new AppError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'Não foi possível validar o login agora.')
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600)
    certs = (await res.json()) as Record<string, string>
    expiresAt = Date.now() + maxAge * 1000
    return certs
  }

  return async (idToken) => {
    const kid = jwt.decode(idToken, { complete: true })?.header.kid
    if (!kid) throw new AppError(401, 'INVALID_FIREBASE_TOKEN', 'Token do Firebase inválido.')
    // Se o Google rotacionou as chaves, o cache não tem o kid: busca de novo uma vez.
    const cert = (await loadCerts())[kid] ?? (await loadCerts(true))[kid]
    if (!cert) throw new AppError(401, 'INVALID_FIREBASE_TOKEN', 'Token do Firebase inválido.')
    try {
      const payload = jwt.verify(idToken, cert, {
        algorithms: ['RS256'],
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`,
      }) as jwt.JwtPayload
      if (!payload.sub) throw new Error('sem sub')
      return {
        uid: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      }
    } catch {
      throw new AppError(401, 'INVALID_FIREBASE_TOKEN', 'Token do Firebase inválido ou expirado.')
    }
  }
}
