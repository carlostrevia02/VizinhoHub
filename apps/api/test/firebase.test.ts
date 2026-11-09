// Verificação do ID token do Firebase sem rede: o fetch dos certificados do Google é simulado
// com um par de chaves RSA gerado aqui (o jsonwebtoken aceita chave pública PEM no lugar do X.509).
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, it } from 'node:test'
import jwt from 'jsonwebtoken'
import { createFirebaseVerifier } from '../src/shared/firebase.js'

const PROJECT = 'vizinhohub'
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = (k: ReturnType<typeof pair>['publicKey']) => k.export({ type: 'spki', format: 'pem' }) as string

const good = pair()
const stranger = pair()
const realFetch = globalThis.fetch
let fetchCalls = 0
let published: Record<string, string>

beforeEach(() => {
  fetchCalls = 0
  published = { 'kid-1': pem(good.publicKey) }
  globalThis.fetch = (async () => {
    fetchCalls++
    return new Response(JSON.stringify(published), { headers: { 'cache-control': 'public, max-age=3600' } })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const sign = (claims: object, opts: { key?: typeof good.privateKey; kid?: string; expiresIn?: number } = {}) =>
  jwt.sign(
    { email: 'maria@gmail.com', email_verified: true, name: 'Maria', ...claims },
    opts.key ?? good.privateKey,
    {
      algorithm: 'RS256',
      keyid: opts.kid ?? 'kid-1',
      subject: 'uid-123',
      audience: PROJECT,
      issuer: `https://securetoken.google.com/${PROJECT}`,
      expiresIn: opts.expiresIn ?? 3600,
      ...('aud' in claims ? { audience: undefined } : {}),
    } as jwt.SignOptions,
  )

describe('createFirebaseVerifier', () => {
  it('aceita um token válido e extrai a identidade', async () => {
    const verify = createFirebaseVerifier(PROJECT)
    assert.deepEqual(await verify(sign({})), { uid: 'uid-123', email: 'maria@gmail.com', emailVerified: true, name: 'Maria' })
  })

  it('guarda os certificados em cache (uma busca para várias validações)', async () => {
    const verify = createFirebaseVerifier(PROJECT)
    await verify(sign({}))
    await verify(sign({}))
    assert.equal(fetchCalls, 1)
  })

  it('recusa projeto errado (audience), emissor errado, expirado e assinatura de outra chave', async () => {
    const verify = createFirebaseVerifier(PROJECT)
    const wrongAud = jwt.sign({}, good.privateKey, { algorithm: 'RS256', keyid: 'kid-1', subject: 'u', audience: 'outro-projeto', issuer: `https://securetoken.google.com/${PROJECT}` })
    const wrongIss = jwt.sign({}, good.privateKey, { algorithm: 'RS256', keyid: 'kid-1', subject: 'u', audience: PROJECT, issuer: 'https://evil.example.com' })
    for (const token of [wrongAud, wrongIss, sign({}, { expiresIn: -10 }), sign({}, { key: stranger.privateKey })]) {
      await assert.rejects(verify(token), { code: 'INVALID_FIREBASE_TOKEN', status: 401 })
    }
  })

  it('recusa token sem assinatura (alg none) e HS256 forjado com o certificado público', async () => {
    const verify = createFirebaseVerifier(PROJECT)
    const none = jwt.sign({ sub: 'u', aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` }, '', { algorithm: 'none', keyid: 'kid-1' } as jwt.SignOptions)
    const hs = jwt.sign({}, published['kid-1']!, { algorithm: 'HS256', keyid: 'kid-1', subject: 'u', audience: PROJECT, issuer: `https://securetoken.google.com/${PROJECT}` })
    for (const token of [none, hs, 'lixo']) await assert.rejects(verify(token), { code: 'INVALID_FIREBASE_TOKEN' })
  })

  it('rotação de chaves: kid novo força uma nova busca; kid inexistente é recusado', async () => {
    const verify = createFirebaseVerifier(PROJECT)
    await verify(sign({}))
    const rotated = pair()
    published = { 'kid-1': pem(good.publicKey), 'kid-2': pem(rotated.publicKey) }
    assert.equal((await verify(sign({}, { key: rotated.privateKey, kid: 'kid-2' }))).uid, 'uid-123')
    assert.equal(fetchCalls, 2)
    await assert.rejects(verify(sign({}, { kid: 'kid-fantasma' })), { code: 'INVALID_FIREBASE_TOKEN' })
  })

  it('Google fora do ar → 503, não um falso "token inválido"', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 500 })) as typeof fetch
    await assert.rejects(createFirebaseVerifier(PROJECT)(sign({})), { status: 503 })
  })
})
