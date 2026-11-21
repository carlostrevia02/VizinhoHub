import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { norm } from '../lib/catalog'

const MAX = 50

// Seletor de produto com busca (sem acento) para listas grandes: mostra no máximo `max` resultados.
// Combobox acessível: setas/Enter/Esc no teclado, clique no mouse. Use com <label htmlFor={id}>.
function ProductPicker({ id, products, value, onChange, getHint, placeholder = 'Digite para buscar…', max = MAX, disabled = false, ariaLabel }) {
  const auto = useId()
  const inputId = id ?? auto
  const listId = `${inputId}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null)

  const index = useMemo(() => (products ?? []).map((p) => ({ p, key: norm(p.name ?? '') })), [products])
  const selected = (products ?? []).find((p) => p.id === value) ?? null
  const terms = norm(query).split(/\s+/).filter(Boolean)
  const matches = index.filter(({ key }) => terms.every((t) => key.includes(t)))
  const shown = matches.slice(0, max).map((m) => m.p)

  const activeId = open && shown[active] ? `${inputId}-o${shown[active].id}` : undefined
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const choose = (p) => {
    onChange(p.id)
    setQuery('')
    setOpen(false)
  }
  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      const n = shown.length
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n))
    } else if (e.key === 'Enter') {
      if (open && shown[active]) {
        e.preventDefault()
        choose(shown[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      }
    }
  }

  return (
    <div className="picker" ref={box}>
      <div className="picker-box">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-activedescendant={activeId}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected ? '' : placeholder}
          value={open ? query : selected ? selected.name : ''}
          onFocus={() => {
            setActive(0)
            setOpen(true)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        {selected && !disabled && (
          <button type="button" className="picker-clear" aria-label="Limpar produto" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setQuery('') }}>
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="picker-pop" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" className="picker-list">
            {shown.map((p, i) => (
              <li
                key={p.id}
                id={`${inputId}-o${p.id}`}
                role="option"
                aria-selected={p.id === value}
                className={i === active ? 'on' : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
              >
                <span>{p.name}</span>
                {getHint && <small>{getHint(p)}</small>}
              </li>
            ))}
          </ul>
          <p className="picker-status muted" role="status" aria-live="polite">
            {matches.length === 0
              ? products === null ? 'Carregando produtos…' : 'Nenhum produto encontrado.'
              : matches.length > shown.length
                ? `Mostrando ${shown.length} de ${matches.length}. Digite mais para refinar.`
                : `${matches.length} ${matches.length === 1 ? 'produto' : 'produtos'}.`}
          </p>
        </div>
      )}
    </div>
  )
}

export default ProductPicker
