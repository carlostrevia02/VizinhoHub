import { addDays, daysBetween, todayISO } from './format'
import type { DateRange } from './types'

export const MAX_DAYS = 366
export type Preset = 'today' | '7d' | '30d' | 'custom'

/** Período efetivo de um atalho (termina hoje, em Fortaleza). */
export function presetRange(preset: Exclude<Preset, 'custom'>): DateRange {
  const endDate = todayISO()
  const span = preset === 'today' ? 1 : preset === '7d' ? 7 : 30
  return { startDate: addDays(endDate, -(span - 1)), endDate }
}

/** Mensagem de erro para um período personalizado, ou null se estiver bom. */
export function validateCustom(r: DateRange): string | null {
  if (!r.startDate || !r.endDate) return 'Escolha as duas datas.'
  const days = daysBetween(r.startDate, r.endDate)
  if (days < 1) return 'A data final não pode ser antes da inicial.'
  if (days > MAX_DAYS) return `Escolha no máximo ${MAX_DAYS} dias.`
  return null
}
