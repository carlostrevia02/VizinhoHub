import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { documentedRoutes } from './all.js'
import type { AuthMode, ErrorStatus, RouteDoc, ZodSchema } from './registry.js'
import { TAGS } from './tags.js'

// Gera o documento OpenAPI 3.1 a partir do registro de rotas (./routes) e dos schemas zod que as rotas já usam.
// Nada aqui é escrito à mão por rota: o que muda no zod muda no spec.

type Json = Record<string, any>

const BASE_PATH = '/api/v1'

function apiVersion(): string {
  try {
    const file = path.resolve(import.meta.dirname, '../../package.json')
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// ---- zod → JSON Schema ------------------------------------------------------------------------------
function toJsonSchema(schema: ZodSchema): Json {
  // io: 'input' = o que o cliente envia (defaults opcionais, coerce/transform pelo lado de entrada).
  const json = z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' }) as Json
  delete json.$schema
  return dropUuidPatterns(json) as Json
}

// z.uuid() emite `format: uuid` e também a regex enorme do RFC 9562: a regex só polui a documentação.
function dropUuidPatterns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropUuidPatterns)
  if (node && typeof node === 'object') {
    const obj = node as Json
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => !(k === 'pattern' && obj.format === 'uuid'))
        .map(([k, v]) => [k, dropUuidPatterns(v)]),
    )
  }
  return node
}

// Move `$defs` locais para components.schemas (nomes prefixados para não colidir entre operações).
function hoistDefs(json: Json, prefix: string, components: Json): Json {
  const defs = json.$defs as Json | undefined
  if (!defs) return json
  delete json.$defs
  const rename = (name: string) => `${prefix}_${name}`
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite)
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) =>
          k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/') ? [k, `#/components/schemas/${rename(v.slice('#/$defs/'.length))}`] : [k, rewrite(v)],
        ),
      )
    }
    return node
  }
  for (const [name, def] of Object.entries(defs)) components.schemas[rename(name)] = rewrite(def)
  return rewrite(json) as Json
}

// Objeto → lista de parâmetros OpenAPI (query ou path).
function toParameters(schema: ZodSchema, where: 'query' | 'path'): Json[] {
  const json = toJsonSchema(schema)
  const props = (json.properties ?? {}) as Record<string, Json>
  const required = new Set<string>(json.required ?? [])
  return Object.entries(props).map(([name, prop]) => {
    const { description, ...rest } = prop
    return { name, in: where, required: where === 'path' ? true : required.has(name), ...(description ? { description } : {}), schema: rest }
  })
}

// ---- operação ---------------------------------------------------------------------------------------
const pathParamNames = (p: string) => [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)

const camel = (s: string) => s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
export const operationId = (r: Pick<RouteDoc, 'method' | 'path'>) => {
  const name = r.path
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith('{') ? `By-${seg.slice(1, -1)}` : seg))
    .join('-')
  return r.method + camel(`-${name}`)
}

const ERROR_RESPONSES: Record<ErrorStatus, string> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  422: 'Unprocessable',
  429: 'TooManyRequests',
  501: 'NotImplemented',
}

function errorStatuses(r: RouteDoc): ErrorStatus[] {
  const codes = new Set<ErrorStatus>(r.errors ?? [])
  if (r.body || r.query || r.params || r.rawBody) codes.add(400)
  if (r.auth !== 'public') codes.add(401)
  if (r.auth === 'MERCHANT' || r.auth === 'CUSTOMER') codes.add(403)
  if (pathParamNames(r.path).length) codes.add(404)
  return [...codes].sort((a, b) => a - b)
}

const AUTH_TEXT: Record<AuthMode, string> = {
  public: 'Pública (sem login).',
  optional: 'Login opcional: com `Authorization: Bearer <token>` valida e identifica o usuário; sem token segue anônimo.',
  login: 'Exige login (qualquer papel).',
  MERCHANT: 'Exige login com papel `MERCHANT` (lojista).',
  CUSTOMER: 'Exige login com papel `CUSTOMER` (cliente).',
}

function buildOperation(r: RouteDoc, components: Json): Json {
  const id = operationId(r)
  const op: Json = {
    operationId: id,
    tags: [r.tag],
    summary: r.summary,
    description: [r.description, AUTH_TEXT[r.auth]].filter(Boolean).join('\n\n'),
  }

  if (r.auth === 'optional') op.security = [{}, { bearerAuth: [] }]
  else op.security = r.auth === 'public' ? [] : [{ bearerAuth: [] }]
  if (r.auth === 'MERCHANT' || r.auth === 'CUSTOMER') op['x-required-role'] = r.auth

  // Parâmetros: caminho (do schema, senão string), depois query.
  const fromSchema = r.params ? toParameters(r.params, 'path') : []
  const parameters = pathParamNames(r.path).map(
    (name) => fromSchema.find((p) => p.name === name) ?? { name, in: 'path', required: true, schema: { type: 'string' } },
  )
  if (r.query) parameters.push(...toParameters(r.query, 'query'))
  if (parameters.length) op.parameters = parameters

  if (r.body) {
    const json = hoistDefs(toJsonSchema(r.body), id, components)
    op.requestBody = { required: Array.isArray(json.required) && json.required.length > 0, content: { 'application/json': { schema: json } } }
  } else if (r.rawBody) {
    op.requestBody = { required: true, description: r.rawBody.description, content: { [r.rawBody.contentType]: { schema: { type: 'string', format: 'binary' } } } }
  }

  const [status, description, outSchema] = r.ok ?? [200, 'Sucesso.']
  const success: Json = { description }
  if (status !== 204) {
    success.content = { 'application/json': outSchema ? { schema: hoistDefs(toJsonSchema(outSchema), `${id}_res`, components) } : { schema: {} } }
  }
  op.responses = { [status]: success }
  for (const code of errorStatuses(r)) op.responses[code] = { $ref: `#/components/responses/${ERROR_RESPONSES[code]}` }
  return op
}

// ---- documento --------------------------------------------------------------------------------------
const errorExample = (code: string, message: string) => ({ error: { code, message } })

const errorResponse = (description: string, code: string, message: string): Json => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: errorExample(code, message) } },
})

export function buildOpenApiSpec(routes: RouteDoc[] = documentedRoutes): Json {
  const components: Json = {
    schemas: {
      Error: {
        type: 'object',
        description: 'Envelope de erro de toda a API. `code` é estável (o frontend decide a mensagem por ele); `details` só aparece em alguns erros (ex.: lista de campos em `VALIDATION_ERROR`).',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', examples: ['VALIDATION_ERROR'] },
              message: { type: 'string' },
              details: { description: 'Informação extra opcional.' },
            },
          },
        },
      },
    },
    responses: {
      BadRequest: errorResponse('Dados inválidos (`VALIDATION_ERROR`, com `details` por campo) ou requisição malformada (`BAD_REQUEST`).', 'VALIDATION_ERROR', 'Dados inválidos.'),
      Unauthorized: errorResponse('Sem login, token inválido ou expirado (`UNAUTHENTICATED`, `INVALID_TOKEN`).', 'UNAUTHENTICATED', 'Faça login para continuar.'),
      Forbidden: errorResponse('O papel do usuário não pode usar esta rota (`FORBIDDEN`).', 'FORBIDDEN', 'Você não tem permissão para esta ação.'),
      NotFound: errorResponse('Recurso não encontrado.', 'NOT_FOUND', 'Não encontrado.'),
      Conflict: errorResponse('Conflito com o estado atual (registro já existe, transição inválida etc.).', 'DUPLICATE', 'Registro já existe.'),
      Unprocessable: errorResponse('Regra de negócio violada (oferta esgotada, período inválido, referência inexistente etc.).', 'INVALID_REFERENCE', 'Referência inexistente.'),
      TooManyRequests: errorResponse('Limite de requisições excedido.', 'RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.'),
      NotImplemented: errorResponse('Recurso não configurado neste servidor.', 'NOT_CONFIGURED', 'Recurso não configurado.'),
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token devolvido por `POST /auth/login`, `/auth/register` ou `/auth/firebase`. Cole só o token (o Swagger UI acrescenta `Bearer`). O papel (`MERCHANT`/`CUSTOMER`) vem do banco, não do token.',
      },
    },
  }

  const paths: Json = {}
  for (const r of routes) {
    const item = (paths[r.path] ??= r.root ? { servers: [{ url: '/' }] } : {})
    item[r.method] = buildOperation(r, components)
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'VizinhoHub API',
      version: apiVersion(),
      description:
        'API do VizinhoHub: vitrine de mercadinhos de bairro com Salva-Estoque, pedidos em tempo real, entrega, caderneta, Clube VIP e mais.\n\n' +
        'Base: `/api/v1` (`/api` continua valendo). Erros seguem o envelope `{ "error": { "code", "message", "details?" } }`. ' +
        'Tempo real (pedidos, entregas, impressão) usa Socket.IO no mesmo servidor e não faz parte deste documento.\n\n' +
        'Gerado a partir do código: `apps/api/src/docs`. Para exportar o YAML: `npm run openapi`.',
    },
    servers: [{ url: BASE_PATH, description: 'API v1' }],
    tags: TAGS.map(({ name, description }) => ({ name, description })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components,
  }
}

let cached: Json | undefined
export const openApiSpec = () => (cached ??= buildOpenApiSpec())
