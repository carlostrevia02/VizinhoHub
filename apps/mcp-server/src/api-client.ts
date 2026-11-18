import type { Config } from './config.js'

/** Erro devolvido pela API (envelope `{ error: { code, message, details } }`) ou de rede. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Texto legível: "[CODIGO] mensagem (campo: motivo; ...)". */
  describe(): string {
    let extra = ''
    if (Array.isArray(this.details) && this.details.length > 0) {
      extra =
        ' (' +
        this.details
          .map((d) => (d && typeof d === 'object' && 'message' in d ? `${(d as { path?: string }).path ? (d as { path?: string }).path + ': ' : ''}${(d as { message: string }).message}` : String(d)))
          .join('; ') +
        ')'
    }
    return `[${this.code}] ${this.message}${extra}`
  }
}

export interface ApiClient {
  request<T = unknown>(method: string, path: string, opts?: { query?: Record<string, string | number | boolean | undefined>; body?: unknown }): Promise<T>
}

export function createApiClient(config: Config, fetchImpl: typeof fetch = fetch): ApiClient {
  const base = `${config.apiUrl}/api/v1`
  let jwt: string | undefined = config.token
  const fixedToken = Boolean(config.token)

  async function login(): Promise<string> {
    if (!config.email || !config.password) throw new ApiError(401, 'UNAUTHENTICATED', 'Sem credenciais para entrar.')
    const res = await raw('POST', '/auth/login', undefined, { email: config.email, password: config.password }, false)
    const token = (res as { token?: string } | undefined)?.token
    if (!token) throw new ApiError(502, 'LOGIN_FAILED', 'A API não devolveu um token no login.')
    jwt = token
    return token
  }

  async function raw(method: string, path: string, query: Record<string, string | number | boolean | undefined> | undefined, body: unknown, auth: boolean): Promise<unknown> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v))
    const url = `${base}${path}${qs.size ? `?${qs}` : ''}`
    let res: Response
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          ...(body !== undefined && { 'content-type': 'application/json' }),
          ...(auth && jwt && { authorization: `Bearer ${jwt}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new ApiError(0, 'NETWORK_ERROR', `Não consegui falar com a API em ${config.apiUrl}: ${(err as Error).message}`)
    }
    const text = await res.text()
    let parsed: unknown
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
    }
    if (!res.ok) {
      const e = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error
      throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? (text.slice(0, 200) || res.statusText), e?.details)
    }
    return parsed
  }

  return {
    async request<T>(method: string, path: string, opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}) {
      if (!jwt && !fixedToken) await login()
      try {
        return (await raw(method, path, opts.query, opts.body, true)) as T
      } catch (err) {
        // Token expirado: com e-mail/senha, entra de novo UMA vez e repete.
        if (err instanceof ApiError && err.status === 401 && !fixedToken && config.email && config.password) {
          await login()
          return (await raw(method, path, opts.query, opts.body, true)) as T
        }
        throw err
      }
    },
  }
}
