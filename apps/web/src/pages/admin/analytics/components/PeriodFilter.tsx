import { useId } from 'react'
import type { DateRange } from '../types'
import { MAX_DAYS, type Preset } from '../range'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'custom', label: 'Personalizado' },
]

interface Props {
  preset: Preset
  onPreset: (p: Preset) => void
  custom: DateRange
  onCustom: (r: DateRange) => void
  /** Mensagem de erro do período personalizado (ou null se válido). */
  customError: string | null
  max: string
}

// Filtro global de período. Os atalhos são botões de verdade (teclado e leitor de tela); o personalizado abre dois campos de data.
function PeriodFilter({ preset, onPreset, custom, onCustom, customError, max }: Props) {
  const id = useId()
  return (
    <div className="an-period">
      <div className="an-seg" role="group" aria-label="Período">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={preset === p.id} className={preset === p.id ? 'on' : undefined} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="an-custom">
          <label htmlFor={`${id}-s`}>De</label>
          <input id={`${id}-s`} type="date" value={custom.startDate} max={custom.endDate || max} onChange={(e) => onCustom({ ...custom, startDate: e.target.value })} />
          <label htmlFor={`${id}-e`}>até</label>
          <input id={`${id}-e`} type="date" value={custom.endDate} min={custom.startDate} max={max} onChange={(e) => onCustom({ ...custom, endDate: e.target.value })} />
          {customError && (
            <span className="an-field-error" role="alert">
              {customError}
            </span>
          )}
          <span className="an-hint">Máximo de {MAX_DAYS} dias.</span>
        </div>
      )}
    </div>
  )
}

export default PeriodFilter
