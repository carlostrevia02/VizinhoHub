import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { AppError } from '../src/shared/errors.js'
import type { FirebaseVerifier } from '../src/shared/firebase.js'
import { startTestEnv, tokenFor, LUCIA, type TestEnv } from './helpers.js'

// Verificador falso: o "ID token" é um JSON com a identidade (a validação real usa os certificados do Google).
const fakeFirebase: FirebaseVerifier = async (idToken) => {
  try {
    return JSON.parse(idToken)
  } catch {
    throw new AppError(401, 'INVALID_FIREBASE_TOKEN', 'Token do Firebase inválido.')
  }
}
const idToken = (identity: object) => JSON.stringify({ padding: 'x'.repeat(30), ...identity })

let t: TestEnv
before(async () => {
  t = await startTestEnv(54331, { firebase: fakeFirebase })
})
after(() => t?.stop())

describe('cadastro e login próprios', () => {
  it('cadastra um CUSTOMER, devolve token e não expõe a senha', async () => {
    const res = await t.api('POST', '/api/v1/auth/register', { body: { name: 'João Pedro', email: 'Joao@Exemplo.com', password: 'senha-forte-1' } })
    assert.equal(res.status, 201)
    assert.equal(res.body.user.role, 'CUSTOMER')
    assert.equal(res.body.user.email, 'joao@exemplo.com')
    assert.equal(res.body.user.store, null)
    assert.ok(res.body.token)
    assert.equal(JSON.stringify(res.body).includes('password'), false)
  })

  it('recusa e-mail repetido (409), senha curta e e-mail inválido (400)', async () => {
    const dup = await t.api('POST', '/api/v1/auth/register', { body: { name: 'Outro', email: 'joao@exemplo.com', password: 'outra-senha-1' } })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'EMAIL_IN_USE')
    assert.equal((await t.api('POST', '/api/v1/auth/register', { body: { name: 'Ana', email: 'ana@x.com', password: '123' } })).status, 400)
    assert.equal((await t.api('POST', '/api/v1/auth/register', { body: { name: 'Ana', email: 'nao-e-email', password: 'senha-forte-1' } })).status, 400)
  })

  it('faz login e carrega /me; senha errada e e-mail inexistente dão o mesmo 401', async () => {
    const ok = await t.api('POST', '/api/v1/auth/login', { body: { email: 'joao@exemplo.com', password: 'senha-forte-1' } })
    assert.equal(ok.status, 200)
    const me = await t.api('GET', '/api/v1/auth/me', { token: ok.body.token })
    assert.equal(me.status, 200)
    assert.equal(me.body.name, 'João Pedro')

    const wrong = await t.api('POST', '/api/v1/auth/login', { body: { email: 'joao@exemplo.com', password: 'errada-errada' } })
    const ghost = await t.api('POST', '/api/v1/auth/login', { body: { email: 'ninguem@exemplo.com', password: 'errada-errada' } })
    assert.equal(wrong.status, 401)
    assert.deepEqual(wrong.body, ghost.body)
  })

  it('usuários do seed entram com a senha de desenvolvimento e mantêm o papel do banco', async () => {
    const ze = await t.api('POST', '/api/v1/auth/login', { body: { email: 'ze@vizinhohub.test', password: 'vizinho123' } })
    assert.equal(ze.status, 200)
    assert.equal(ze.body.user.role, 'MERCHANT')
    assert.equal(ze.body.user.store.name, 'Mercadinho do Zé')
    const wrong = await t.api('POST', '/api/v1/auth/login', { body: { email: 'maria@vizinhohub.test', password: 'qualquer-coisa' } })
    assert.equal(wrong.status, 401)
  })

  it('/me exige token', async () => {
    assert.equal((await t.api('GET', '/api/v1/auth/me')).status, 401)
  })
})

describe('perfil', () => {
  it('cliente altera o nome mas não envia dados de loja (403)', async () => {
    const reg = await t.api('POST', '/api/v1/auth/register', { body: { name: 'Carla', email: 'carla@exemplo.com', password: 'senha-forte-1' } })
    const upd = await t.api('PATCH', '/api/v1/auth/me', { token: reg.body.token, body: { name: 'Carla Dias' } })
    assert.equal(upd.body.name, 'Carla Dias')
    const store = await t.api('PATCH', '/api/v1/auth/me', { token: reg.body.token, body: { store: { name: 'Minha loja' } } })
    assert.equal(store.status, 403)
  })

  it('comerciante atualiza dados e coordenadas da loja', async () => {
    const res = await t.api('PATCH', '/api/v1/auth/me', {
      token: tokenFor(LUCIA),
      body: { store: { name: 'Dona Lúcia Mercearia', latitude: -3.74, longitude: -38.49 } },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.store.name, 'Dona Lúcia Mercearia')
    assert.equal(res.body.store.neighborhood, 'Aldeota') // não enviado = preservado
    assert.equal(res.body.store.latitude, -3.74)
    assert.equal((await t.api('PATCH', '/api/v1/auth/me', { token: tokenFor(LUCIA), body: {} })).status, 400)
  })
})

describe('POST /auth/firebase', () => {
  it('cria o cliente no 1º acesso e reconhece o mesmo uid depois', async () => {
    const first = await t.api('POST', '/api/v1/auth/firebase', {
      body: { idToken: idToken({ uid: 'fb-1', email: 'Fernanda@Gmail.com', emailVerified: true, name: 'Fernanda Lima' }) },
    })
    assert.equal(first.status, 200)
    assert.equal(first.body.user.role, 'CUSTOMER')
    assert.equal(first.body.user.name, 'Fernanda Lima')

    const again = await t.api('POST', '/api/v1/auth/firebase', { body: { idToken: idToken({ uid: 'fb-1', email: 'fernanda@gmail.com', emailVerified: true }) } })
    assert.equal(again.body.user.id, first.body.user.id)
  })

  it('vincula a conta existente só se o e-mail for verificado pelo Firebase', async () => {
    const unverified = await t.api('POST', '/api/v1/auth/firebase', { body: { idToken: idToken({ uid: 'fb-2', email: 'joao@exemplo.com', emailVerified: false }) } })
    assert.equal(unverified.status, 409)
    const verified = await t.api('POST', '/api/v1/auth/firebase', { body: { idToken: idToken({ uid: 'fb-2', email: 'joao@exemplo.com', emailVerified: true }) } })
    assert.equal(verified.status, 200)
    assert.equal(verified.body.user.name, 'João Pedro')
  })

  it('cliente do seed entra pelo uid e continua com o papel do banco', async () => {
    const res = await t.api('POST', '/api/v1/auth/firebase', { body: { idToken: idToken({ uid: 'seed-merchant-ze', emailVerified: true }) } })
    assert.equal(res.status, 200)
    assert.equal(res.body.user.role, 'MERCHANT')
  })

  it('rejeita token inválido (401) e não deixa o frontend se autopromover', async () => {
    assert.equal((await t.api('POST', '/api/v1/auth/firebase', { body: { idToken: 'x'.repeat(40) } })).status, 401)
    const res = await t.api('POST', '/api/v1/auth/firebase', {
      body: { idToken: idToken({ uid: 'fb-3', email: 'espertinho@x.com', emailVerified: true }), role: 'MERCHANT' },
    })
    assert.equal(res.body.user.role, 'CUSTOMER')
  })
})

describe('infra HTTP', () => {
  it('responde 404 JSON para rota desconhecida e 400 para JSON malformado', async () => {
    const nf = await t.api('GET', '/api/v1/nada')
    assert.equal(nf.status, 404)
    assert.equal(nf.body.error.code, 'ROUTE_NOT_FOUND')
    const res = await fetch(`${t.baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{quebrado' })
    assert.equal(res.status, 400)
  })

  it('aceita a base /api/v1 e o prefixo antigo /api', async () => {
    assert.equal((await t.api('GET', '/api/categories')).status, 200)
    assert.equal((await t.api('GET', '/api/v1/categories')).status, 200)
  })
})
