import type { z } from 'zod'

// Registro de rotas documentadas. Cada módulo da API tem um arquivo em ./routes/ que lista suas rotas aqui;
// o spec OpenAPI (openapi.ts) e a trava de test/openapi.test.ts partem deste mesmo registro.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

// public   = sem login
// optional = o token é opcional (com token valida e identifica o usuário)
// login    = qualquer usuário autenticado
// MERCHANT / CUSTOMER = exige login e este papel
export type AuthMode = 'public' | 'optional' | 'login' | 'MERCHANT' | 'CUSTOMER'

// Aceita schemas zod de qualquer cópia do pacote (packages/contracts tem a sua).
export type ZodSchema = z.ZodType | { _zod: unknown }

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 501

export interface RouteOptions {
  /** Texto longo (Markdown) além do resumo. */
  description?: string
  /** Schema dos parâmetros de caminho (ex.: idParam). Parâmetros sem schema viram `string`. */
  params?: ZodSchema
  query?: ZodSchema
  body?: ZodSchema
  /** Corpo que não é JSON (ex.: upload binário). */
  rawBody?: { contentType: string; description: string }
  /** Resposta de sucesso: [status, descrição, schema de saída (opcional)]. Padrão: 200 "Sucesso". */
  ok?: readonly [status: 200 | 201 | 202 | 204, description: string, schema?: ZodSchema]
  /** Erros além dos deduzidos (400 se há entrada, 401/403 pelo `auth`, 404 se há parâmetro de caminho). */
  errors?: readonly ErrorStatus[]
}

export interface RouteDoc extends RouteOptions {
  method: HttpMethod
  /** Formato OpenAPI, relativo a /api/v1: `/orders/{id}`. */
  path: string
  tag: string
  summary: string
  auth: AuthMode
  /** Rota fora de /api/v1 (ex.: GET /health). */
  root?: boolean
}

export const routeFor =
  (tag: string) =>
  (method: HttpMethod, path: string, auth: AuthMode, summary: string, options: RouteOptions = {}): RouteDoc => ({
    method,
    path,
    tag,
    summary,
    auth,
    ...options,
  })
