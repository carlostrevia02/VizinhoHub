import { type AuthUser, signToken } from '../../shared/auth.js'
import type { Db } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { FirebaseVerifier } from '../../shared/firebase.js'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../shared/password.js'
import * as repo from './auth.repository.js'
import type { BecomeMerchantInput, FirebaseLoginInput, LoginInput, RegisterInput, UpdateMeInput } from './auth.schema.js'
import type { AuthResultDTO, UserDTO } from './auth.types.js'

export function createAuthService(deps: { db: Db; jwtSecret: string; firebase?: FirebaseVerifier }) {
  const { db, jwtSecret, firebase } = deps

  async function result(userId: string): Promise<AuthResultDTO> {
    const user = (await repo.findUserDtoById(db, userId))!
    return { token: signToken(userId, jwtSecret), user }
  }

  // Todo cadastro público nasce CUSTOMER; comerciante é criado fora da API (scripts/create-merchant.ts).
  async function register(input: RegisterInput): Promise<AuthResultDTO> {
    if (await repo.findCredentialByEmail(db, input.email)) {
      throw new AppError(409, 'EMAIL_IN_USE', 'Já existe uma conta com este e-mail.')
    }
    const id = await repo.insertCustomer(db, { name: input.name, email: input.email, passwordHash: await hashPassword(input.password) })
    return result(id)
  }

  async function login(input: LoginInput): Promise<AuthResultDTO> {
    const row = await repo.findCredentialByEmail(db, input.email)
    // Sempre verifica um hash (mesmo sem usuário) para não revelar quais e-mails existem pelo tempo de resposta.
    const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH)
    if (!row || !row.password_hash || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.')
    return result(row.id)
  }

  // Troca o ID token do Firebase (login do frontend) pelo token da API.
  async function loginWithFirebase(input: FirebaseLoginInput): Promise<AuthResultDTO> {
    if (!firebase) throw new AppError(501, 'FIREBASE_NOT_CONFIGURED', 'Login com Firebase não configurado (FIREBASE_PROJECT_ID).')
    const identity = await firebase(input.idToken)

    const existing = await repo.findIdByFirebaseUid(db, identity.uid)
    if (existing) return result(existing)

    if (!identity.email) throw new AppError(422, 'EMAIL_REQUIRED', 'A conta do Firebase não tem e-mail.')
    const email = identity.email.toLowerCase()

    // Mesmo e-mail de uma conta já existente: só vincula se o Firebase garante que o e-mail é do usuário.
    const sameEmail = await repo.findCredentialByEmail(db, email)
    if (sameEmail) {
      if (!identity.emailVerified || sameEmail.firebase_uid) {
        throw new AppError(409, 'EMAIL_IN_USE', 'Já existe uma conta com este e-mail.')
      }
      await repo.linkFirebaseUid(db, sameEmail.id, identity.uid)
      return result(sameEmail.id)
    }

    const name = input.name ?? identity.name ?? email.split('@')[0]!
    return result(await repo.insertCustomer(db, { name, email, firebaseUid: identity.uid }))
  }

  const me = async (user: AuthUser): Promise<UserDTO> => (await repo.findUserDtoById(db, user.id))!

  async function updateMe(user: AuthUser, input: UpdateMeInput): Promise<UserDTO> {
    if (input.store && user.role !== 'MERCHANT') {
      throw new AppError(403, 'FORBIDDEN', 'Somente comerciantes têm dados de loja.')
    }
    if (input.name) await repo.updateName(db, user.id, input.name)
    if (input.phone !== undefined) await repo.updatePhone(db, user.id, input.phone)
    if (input.store) await repo.updateStore(db, user.id, input.store)
    return me(user)
  }

  // Abre uma loja a partir de uma conta de cliente. O token continua valendo: o papel é lido do banco a cada chamada.
  async function becomeMerchant(user: AuthUser, input: BecomeMerchantInput): Promise<UserDTO> {
    if (user.role === 'MERCHANT') throw new AppError(409, 'ALREADY_MERCHANT', 'Esta conta já é de comerciante.')
    await repo.promoteToMerchant(db, user.id, input.store)
    return me(user)
  }

  return { register, login, loginWithFirebase, me, updateMe, becomeMerchant }
}

export type AuthService = ReturnType<typeof createAuthService>
