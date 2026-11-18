// Trava contra documentação desatualizada: compara as rotas realmente montadas no Express com o spec OpenAPI
// gerado de src/docs. Não precisa de banco: a app é montada com um Db de mentira e nenhuma rota é chamada.
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import { buildServer } from '../src/app.js'
import { openApiSpec } from '../src/docs/openapi.js'
import { DOCS_JSON_PATHS, DOCS_UI_PATHS } from '../src/docs/serve.js'
import { TAGS } from '../src/docs/tags.js'
import type { Db } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'

const baseEnv = { DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x', JWT_SECRET: 'test-secret-with-enough-length', NODE_ENV: 'test' }
const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db

const built = buildServer(loadEnv(baseEnv), fakeDb)

// ---- percorre a pilha do Express 5 (router 2.x) ------------------------------------------------------
// Uma layer de router montado (`use('/x', router)`) não guarda o prefixo, só `matchers`; o prefixo é descoberto
// sondando os matchers com os pontos de montagem conhecidos (TAGS[].mounts). Router montado em prefixo
// desconhecido faz o teste falhar: é exatamente o caso "módulo novo sem documentação".
interface Layer {
  name: string
  route?: { path: string | string[]; methods: Record<string, boolean> }
  handle: { stack?: Layer[] }
  matchers: Array<(p: string) => false | { path: string }>
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
const join = (mount: string, p: string) => (p === '/' ? mount : (mount + p).replace(/\/+$/, ''))
// A layer foi montada exatamente em `prefix`? (um matcher de '/api' também casaria '/api/docs/x': compara o trecho casado.)
const mountedAt = (layer: Layer, prefix: string) => layer.matchers.some((m) => m(`${prefix}/__probe__`) !== false && (m(`${prefix}/__probe__`) as { path: string }).path === prefix)

function routesOf(stack: Layer[], mount: string, problems: string[], out: Set<string>) {
  for (const layer of stack) {
    if (layer.route) {
      for (const p of [layer.route.path].flat()) {
        for (const m of Object.keys(layer.route.methods).filter((k) => layer.route!.methods[k])) {
          out.add(`${m.toUpperCase()} ${toOpenApiPath(join(mount, p))}`)
        }
      }
    } else if (layer.handle.stack) {
      const mounts = TAGS.flatMap((t) => t.mounts).filter((m) => mountedAt(layer, m))
      if (mounts.length !== 1) {
        problems.push(`Router montado em prefixo que não está em TAGS[].mounts (src/docs/tags.ts): ${mounts.length ? 'ambíguo ' + mounts.join(', ') : 'sem correspondência'}.`)
        continue
      }
      routesOf(layer.handle.stack, join(mount, mounts[0]!), problems, out)
    }
  }
}

function expressRoutes(app: typeof built.app) {
  const out = new Set<string>()
  const problems: string[] = []
  const docs = new Set([...DOCS_JSON_PATHS, ...DOCS_UI_PATHS])
  for (const layer of (app as any).router.stack as Layer[]) {
    if (layer.route) {
      const paths = [layer.route.path].flat()
      if (paths.every((p) => docs.has(p))) continue
      routesOf([layer], '', problems, out) // rotas na raiz (ex.: /health)
    } else if (layer.handle.stack) {
      // O router da API é montado em ['/api/v1', '/api']: as rotas valem nos dois, o spec usa a base /api/v1.
      if (!mountedAt(layer, '/api/v1') || !mountedAt(layer, '/api')) problems.push('Router de topo montado fora de /api e /api/v1.')
      else routesOf(layer.handle.stack, '', problems, out)
    }
  }
  return { routes: out, problems }
}

// ---- spec ----------------------------------------------------------------------------------------------
type Json = Record<string, any>
const spec = openApiSpec() as Json

function specRoutes() {
  const out = new Set<string>()
  for (const [p, item] of Object.entries<Json>(spec.paths)) {
    for (const m of METHODS) if (item[m]) out.add(`${m.toUpperCase()} ${p}`)
  }
  return out
}

describe('OpenAPI x rotas do Express', () => {
  test('toda rota montada no Express está no spec, e vice-versa', () => {
    const { routes, problems } = expressRoutes(built.app)
    assert.deepEqual(problems, [], problems.join('\n'))
    assert.ok(routes.size > 100, `esperava >100 rotas no Express, achei ${routes.size} (a varredura da pilha quebrou?)`)
    const documented = specRoutes()
    const missingInSpec = [...routes].filter((r) => !documented.has(r)).sort()
    const missingInExpress = [...documented].filter((r) => !routes.has(r)).sort()
    assert.deepEqual(
      { 'no Express mas não documentadas (adicione em src/docs/routes)': missingInSpec, 'documentadas mas inexistentes no Express': missingInExpress },
      { 'no Express mas não documentadas (adicione em src/docs/routes)': [], 'documentadas mas inexistentes no Express': [] },
    )
  })

  test('as rotas de documentação não entram no spec e somem com API_DOCS=false', async () => {
    const off = buildServer(loadEnv({ ...baseEnv, API_DOCS: 'false' }), fakeDb)
    try {
      const layers = (off.app as any).router.stack as Layer[]
      const hasDocs = layers.some((l) => [l.route?.path ?? []].flat().some((p) => DOCS_JSON_PATHS.includes(p)) || DOCS_UI_PATHS.some((p) => mountedAt(l, p)))
      assert.equal(hasDocs, false)
      assert.ok(!Object.keys(spec.paths).some((p) => p.includes('openapi.json') || p.includes('/docs')))
    } finally {
      off.io.close()
    }
  })
})

describe('OpenAPI válido', () => {
  test('cabeçalho: 3.1, servidor /api/v1, bearer JWT, envelope de erro', () => {
    assert.match(spec.openapi, /^3\.1\./)
    assert.equal(spec.info.title, 'VizinhoHub API')
    assert.match(spec.info.version, /^\d+\.\d+\.\d+/)
    assert.deepEqual(spec.servers, [{ url: '/api/v1', description: 'API v1' }])
    assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer')
    assert.equal(spec.components.securitySchemes.bearerAuth.bearerFormat, 'JWT')
    assert.deepEqual(spec.components.schemas.Error.properties.error.required, ['code', 'message'])
  })

  test('todo $ref resolve', () => {
    const broken: string[] = []
    const walk = (node: unknown, where: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}/${i}`))
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') {
          const target = v.startsWith('#/') ? v.slice(2).split('/').reduce<any>((acc, seg) => acc?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')], spec) : undefined
          if (target === undefined) broken.push(`${where} -> ${v}`)
        } else walk(v, `${where}/${k}`)
      }
    }
    walk(spec, '#')
    assert.deepEqual(broken, [])
  })

  test('todo parâmetro de caminho está declarado (e só os que existem no caminho)', () => {
    const problems: string[] = []
    for (const [p, item] of Object.entries<Json>(spec.paths)) {
      const inPath = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)
      for (const m of METHODS.filter((k) => item[k])) {
        const declared = (item[m].parameters ?? []).filter((x: Json) => x.in === 'path')
        for (const name of inPath) {
          const d = declared.find((x: Json) => x.name === name)
          if (!d) problems.push(`${m.toUpperCase()} ${p}: parâmetro {${name}} não declarado`)
          else if (d.required !== true) problems.push(`${m.toUpperCase()} ${p}: {${name}} precisa de required: true`)
        }
        for (const d of declared) if (!inPath.includes(d.name)) problems.push(`${m.toUpperCase()} ${p}: parâmetro ${d.name} não existe no caminho`)
      }
    }
    assert.deepEqual(problems, [])
  })

  test('operações: operationId único, tag existente, resumo, resposta de sucesso e segurança coerentes', () => {
    const tags = new Set(TAGS.map((t) => t.name))
    const ids = new Set<string>()
    const problems: string[] = []
    for (const [p, item] of Object.entries<Json>(spec.paths)) {
      for (const m of METHODS.filter((k) => item[k])) {
        const op = item[m] as Json
        const at = `${m.toUpperCase()} ${p}`
        if (!op.operationId || ids.has(op.operationId)) problems.push(`${at}: operationId ausente ou repetido (${op.operationId})`)
        ids.add(op.operationId)
        if (!op.tags?.length || !op.tags.every((t: string) => tags.has(t))) problems.push(`${at}: tag desconhecida (${op.tags})`)
        if (!op.summary) problems.push(`${at}: sem resumo`)
        if (!Object.keys(op.responses).some((c) => c.startsWith('2'))) problems.push(`${at}: sem resposta 2xx`)
        const guarded = Boolean(op.security?.some((s: Json) => 'bearerAuth' in s))
        if (op['x-required-role'] && !guarded) problems.push(`${at}: exige papel mas não declara bearerAuth`)
        if (guarded && !op.responses['401']) problems.push(`${at}: protegida mas sem 401`)
        if (op['x-required-role'] && !op.responses['403']) problems.push(`${at}: com papel mas sem 403`)
      }
    }
    assert.deepEqual(problems, [])
  })
})

// http.get sem agente: o fetch (undici) mantém conexões abertas e derruba o processo no Windows com --test-force-exit.
// Neste Windows uma resposta de ~100 KB no loopback às vezes trava e dá ECONNRESET ~19 s depois (reproduz com um
// http.createServer puro, sem nada do projeto): por isso timeout curto por tentativa e nova tentativa.
const getOnce = (url: string) =>
  new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (text += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text }))
    })
    req.on('error', reject)
    req.setTimeout(3000, () => req.destroy(new Error('timeout')))
  })

async function get(url: string, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await getOnce(url)
    } catch (err) {
      if (i >= attempts) throw err
    }
  }
}

describe('OpenAPI no ar', () => {
  test('GET /api/openapi.json, /api/v1/openapi.json e Swagger UI respondem', async () => {
    await new Promise<void>((resolve) => built.httpServer.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(built.httpServer.address() as AddressInfo).port}`
      for (const p of DOCS_JSON_PATHS) {
        const res = await get(base + p)
        assert.equal(res.status, 200)
        assert.equal((JSON.parse(res.text) as Json).openapi, spec.openapi)
      }
      for (const p of ['/api/docs/', '/api/v1/docs/']) {
        const res = await get(base + p)
        assert.equal(res.status, 200)
        assert.match(res.type, /text\/html/)
        assert.match(res.text, /swagger-ui/i)
      }
      const missing = await get(`${base}/api/v1/nao-existe`)
      assert.equal(missing.status, 404)
    } finally {
      built.io.close()
      await new Promise((resolve) => built.httpServer.close(resolve))
    }
  })
})
