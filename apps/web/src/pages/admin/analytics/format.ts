import type { DateRange } from './types'

const TZ = 'America/Fortaleza'
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const int = new Intl.NumberFormat('pt-BR')
const oneDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nbsp = / /g

export const formatBRL = (n: number) => brl.format(n).replace(nbsp, ' ')
export const formatBRLCompact = (n: number) => brlCompact.format(n).replace(nbsp, ' ')
export const formatInt = (n: number) => int.format(n)
/** 0.8843 → "88,4%" */
export const formatShare = (fraction: number) => `${oneDecimal.format(fraction * 100)}%`
/** 66.67 → "66,7%" (valor já em %). */
export const formatPercent = (pct: number) => `${oneDecimal.format(pct)}%`

// ---------- datas (sempre o dia em Fortaleza, como a API) ----------

export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1

/** "2026-03-10" → "10/03" */
export const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const longDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export const describeRange = (r: DateRange) => (r.startDate === r.endDate ? longDate(r.startDate) : `${shortDate(r.startDate)} a ${longDate(r.endDate)}`)
