// Cliente HTTP da API do VizinhoHub (apps/api). Base configurável por VITE_API_URL.
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api/v1').replace(/\/$/, '')

let token = null
let onUnauthorized = () => {}

export const setApiToken = (t) => {
  token = t
}
// Chamado quando a API recusa o token da sessão (expirado ou usuário removido).
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(method, path, body) {
  // File/Blob (upload de encarte) vai como corpo bruto; o resto, como JSON.
  const raw = typeof Blob !== 'undefined' && body instanceof Blob
  let res
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': raw ? body.type || 'application/octet-stream' : 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor.')
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Erro inesperado.', data?.error?.details)
    if (token && res.status === 401 && err.code === 'INVALID_TOKEN') onUnauthorized()
    throw err
  }
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  upload: (path, file) => request('POST', path, file),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
}

// Monta "?a=1&b=2" ignorando valores vazios.
export const qs = (params) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}
