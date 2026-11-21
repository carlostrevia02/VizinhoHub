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

// Nomes em português dos campos mais comuns nos erros de validação ({ path, message } da API).
const FIELD_NAMES = {
  name: 'Nome', email: 'E-mail', phone: 'Telefone', address: 'Endereço', description: 'Descrição', price: 'Preço',
  offerPrice: 'Preço da oferta', qtyTotal: 'Quantidade', maxPerCustomer: 'Máximo por cliente', radiusM: 'Raio',
  durationMin: 'Duração', pixKey: 'Chave Pix', startsAt: 'Início', endsAt: 'Fim', capacity: 'Vagas', weekday: 'Dia',
  creditLimit: 'Limite', amount: 'Valor', note: 'Observação', paymentMethod: 'Forma de pagamento', categoryId: 'Departamento',
  expirationDate: 'Validade', barcode: 'Código de barras', unit: 'Unidade', components: 'Componentes', quantity: 'Quantidade',
  productId: 'Produto', componentId: 'Produto', leadTimeHours: 'Antecedência', discountCapPct: 'Teto de desconto',
  minOrder: 'Pedido mínimo', neighborhood: 'Bairro', city: 'Cidade', state: 'UF', latitude: 'Latitude', longitude: 'Longitude',
  hours: 'Horário', delivery: 'Entrega', payments: 'Pagamento', image: 'Imagem', password: 'Senha',
}

// Traduz as mensagens mais comuns do zod (inglês); o que já vier em português passa direto.
function translateIssue(msg) {
  const m = String(msg)
  let r
  if ((r = m.match(/^Too small: expected string to have >=(\d+) characters?/))) return `precisa ter pelo menos ${r[1]} caracteres`
  if ((r = m.match(/^Too big: expected string to have <=(\d+) characters?/))) return `pode ter no máximo ${r[1]} caracteres`
  if ((r = m.match(/^Too small: expected (?:array|set) to have >=(\d+) items?/))) return `precisa de pelo menos ${r[1]} itens`
  if ((r = m.match(/^Too big: expected (?:array|set) to have <=(\d+) items?/))) return `pode ter no máximo ${r[1]} itens`
  if ((r = m.match(/^Too small: expected \w+ to be >(=?)\s*(.+)$/))) return r[1] ? `deve ser no mínimo ${r[2]}` : `deve ser maior que ${r[2]}`
  if ((r = m.match(/^Too big: expected \w+ to be <(=?)\s*(.+)$/))) return r[1] ? `deve ser no máximo ${r[2]}` : `deve ser menor que ${r[2]}`
  if (/^Invalid input: expected \w+, received undefined/.test(m) || /^Required$/i.test(m)) return 'campo obrigatório'
  if (/^Invalid( input| string| option| UUID| uuid| email| url| enum|$)/i.test(m)) return 'valor inválido'
  return m
}

/** "Campo: mensagem" (até 3 detalhes, separados por "; "); sem detalhes, devolve `fallback`. */
export function describeDetails(details, fallback) {
  if (!Array.isArray(details) || details.length === 0) return fallback
  const lines = details.slice(0, 3).map((d) => {
    const path = String(d?.path ?? '')
    const field = FIELD_NAMES[path] ?? FIELD_NAMES[path.split('.').pop()] ?? path
    const text = translateIssue(d?.message ?? '')
    return field ? `${field}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1)
  })
  return [...new Set(lines)].join('; ')
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
  let data = null
  try {
    data = await res.json()
  } catch {}
  if (!res.ok) {
    const message = describeDetails(data?.error?.details, data?.error?.message ?? 'Erro inesperado.')
    const err = new ApiError(res.status, data?.error?.code ?? 'ERROR', message, data?.error?.details)
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
