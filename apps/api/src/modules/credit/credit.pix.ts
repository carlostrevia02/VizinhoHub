// "Pix copia e cola" ESTÁTICO (BR Code, EMV QRCPS-MPM) a partir da chave Pix do próprio lojista.
// A plataforma não intermedia o pagamento: só monta o texto que o cliente cola no app do banco.
// Funções puras (sem I/O), testadas em test/credit.test.ts.

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), 4 dígitos hexadecimais maiúsculos. */
export function crc16(text: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// TLV: id (2) + tamanho (2, decimal) + valor.
const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

// Nome e cidade do BR Code: ASCII maiúsculo sem acento, com tamanho máximo.
function ascii(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
}

/** CPF/CNPJ sem pontuação e telefone no formato +55…; e-mail, UUID (aleatória) ficam como estão. */
export function normalizePixKey(key: string): string {
  const k = key.trim()
  if (/^[\d.\-/\s]+$/.test(k)) return k.replace(/\D/g, '') // CPF/CNPJ
  if (/^\+?[\d\s()\-]+$/.test(k)) {
    const digits = k.replace(/\D/g, '')
    return k.startsWith('+') ? `+${digits}` : digits.length >= 12 ? `+${digits}` : `+55${digits}`
  }
  return k
}

export interface PixInput {
  key: string
  merchantName: string
  city: string
  /** Valor em reais (> 0). Omita para deixar o cliente digitar. */
  amount?: number
  /** Identificador da transação (até 25 letras/números). Padrão "***". */
  txid?: string
}

export function buildPixPayload({ key, merchantName, city, amount, txid }: PixInput): string {
  const pixKey = normalizePixKey(key)
  if (!pixKey || pixKey.length > 77) throw new Error('Chave Pix inválida.')
  const account = tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', pixKey))
  const id = (txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const body =
    tlv('00', '01') +
    tlv('01', '11') + // 11 = QR estático (reutilizável)
    account +
    tlv('52', '0000') +
    tlv('53', '986') + // BRL
    (amount && amount > 0 ? tlv('54', amount.toFixed(2)) : '') +
    tlv('58', 'BR') +
    tlv('59', ascii(merchantName, 25) || 'LOJA') +
    tlv('60', ascii(city, 15) || 'BRASIL') +
    tlv('62', tlv('05', id)) +
    '6304'
  return body + crc16(body)
}

/** Confere o CRC de um BR Code completo (usado nos testes). */
export function isValidPixPayload(payload: string): boolean {
  return payload.length > 8 && payload.slice(-8, -4) === '6304' && crc16(payload.slice(0, -4)) === payload.slice(-4)
}
