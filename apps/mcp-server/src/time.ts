// Fuso do lojista: America/Fortaleza = UTC-3 o ano todo (o Brasil não tem mais horário de verão).
// Por isso usamos o deslocamento fixo de -03:00 em vez de Intl: é simples e determinístico.
export const TZ_NAME = 'America/Fortaleza'
export const TZ_OFFSET_MIN = -180
export const TZ_OFFSET_ISO = '-03:00'

const pad = (n: number) => String(n).padStart(2, '0')

/** Relógio de Fortaleza como componentes (via deslocamento fixo). */
function parts(d: Date) {
  const s = new Date(d.getTime() + TZ_OFFSET_MIN * 60_000)
  return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes() }
}

/** YYYY-MM-DD do dia em Fortaleza. */
export function fortalezaDate(d: Date = new Date()): string {
  const p = parts(d)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`
}

/** "HH:MM" em Fortaleza. */
export function fortalezaHHMM(d: Date): string {
  const p = parts(d)
  return `${pad(p.h)}:${pad(p.mi)}`
}

/** "dd/mm HH:MM" em Fortaleza (ou só "HH:MM" quando é hoje). */
export function formatFortaleza(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = parts(d)
  const hhmm = `${pad(p.h)}:${pad(p.mi)}`
  return fortalezaDate(d) === fortalezaDate(now) ? `hoje ${hhmm}` : `${pad(p.d)}/${pad(p.mo)} ${hhmm}`
}

export class TimeError extends Error {}

/** "HH:MM" de hoje em Fortaleza → instante UTC. Erro se o horário já passou (não joga para amanhã). */
export function untilToday(hhmm: string, now: Date = new Date()): { endsAt: Date; endsAtIso: string; durationMin: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) throw new TimeError(`Horário inválido: "${hhmm}". Use o formato HH:MM (ex.: 23:00).`)
  const p = parts(now)
  const endsAt = new Date(Date.UTC(p.y, p.mo - 1, p.d, Number(m[1]), Number(m[2])) - TZ_OFFSET_MIN * 60_000)
  // Para cima: a oferta nunca termina antes do horário pedido (quem cria fixa o fim exato depois com o PATCH).
  const durationMin = Math.ceil((endsAt.getTime() - now.getTime()) / 60_000)
  if (endsAt.getTime() <= now.getTime()) {
    throw new TimeError(`O horário ${hhmm} já passou hoje (agora são ${fortalezaHHMM(now)} em Fortaleza). Informe um horário futuro de hoje ou use duracaoMinutos.`)
  }
  return { endsAt, endsAtIso: `${fortalezaDate(endsAt)}T${hhmm}:00${TZ_OFFSET_ISO}`, durationMin }
}
