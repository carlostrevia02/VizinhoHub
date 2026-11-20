import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { googleActive, isCep, lookupCep, reverseGeocode, searchPlaces } from '../lib/places'
import AddressMap from './AddressMap'

const EMPTY = { label: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '', zip: '', primary: false }
const maskZip = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

// Diálogo para criar/editar um endereço: busca com sugestões (Google Maps), pin no mapa e campos editáveis.
function AddressDialog({ address, canRemove, onSave, onRemove, onClose }) {
  const ref = useRef(null)
  const numberRef = useRef(null)
  const streetRef = useRef(null)
  const cepSeq = useRef(0)
  const editing = Boolean(address?.id)
  const [form, setForm] = useState({ ...EMPTY, ...address })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const seq = useRef(0)
  const skipSearch = useRef(false)

  useLayoutEffect(() => {
    ref.current.showModal()
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const position = form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null

  // CEP completo (na busca ou no campo CEP): preenche rua, bairro, cidade e UF; sobram número e complemento.
  const fillFromCep = async (cep) => {
    const id = ++cepSeq.current
    setBusy(true)
    setNote(null)
    try {
      const p = await lookupCep(cep)
      if (id !== cepSeq.current) return
      if (!p) return setNote({ text: 'CEP não encontrado. Confira os números ou preencha os campos abaixo.', error: true })
      setForm((f) => ({
        ...f,
        street: p.street || f.street,
        neighborhood: p.neighborhood || f.neighborhood,
        city: p.city || f.city,
        state: p.state || f.state,
        zip: p.zip,
        lat: p.lat,
        lng: p.lng,
      }))
      setTimeout(() => (p.street ? numberRef : streetRef).current?.focus(), 0)
    } catch {
      if (id === cepSeq.current) setNote({ text: 'Não foi possível consultar o CEP agora. Preencha os campos abaixo.', error: true })
    } finally {
      if (id === cepSeq.current) setBusy(false)
    }
  }

  // Sugestões enquanto digita (com debounce; respostas atrasadas são descartadas).
  useEffect(() => {
    const q = query.trim()
    if (skipSearch.current) {
      skipSearch.current = false // texto preenchido por uma escolha: não buscar de novo
      return
    }
    if (isCep(q)) {
      setResults([])
      setOpen(false)
      fillFromCep(q)
      return
    }
    if (q.length < 3) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const id = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const found = await searchPlaces(q, ctrl.signal)
        if (id !== seq.current) return
        setResults(found)
        setActive(-1)
        setOpen(true)
        setNote(found.length ? null : { text: 'Nenhum endereço encontrado. Preencha os campos abaixo.' })
      } catch (err) {
        if (err.name !== 'AbortError' && id === seq.current) setNote({ text: 'Não foi possível buscar agora. Preencha os campos abaixo.', error: true })
      } finally {
        if (id === seq.current) setBusy(false)
      }
    }, 350)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query])

  const apply = (p) => {
    setForm((f) => ({ ...f, street: p.street, number: p.number, neighborhood: p.neighborhood, city: p.city, state: p.state, zip: p.zip, lat: p.lat, lng: p.lng }))
    setNote(null)
    if (!p.number) setTimeout(() => numberRef.current?.focus(), 0)
  }

  const choose = async (s) => {
    setOpen(false)
    const text = `${s.main}${s.secondary ? `, ${s.secondary}` : ''}`
    skipSearch.current = text !== query
    setQuery(text)
    seq.current++
    setBusy(true)
    try {
      apply(await s.resolve())
    } catch {
      setNote({ text: 'Não foi possível carregar esse endereço. Tente outro.', error: true })
    } finally {
      setBusy(false)
    }
  }

  const fromPin = async ({ lat, lng }) => {
    setForm((f) => ({ ...f, lat, lng }))
    try {
      const p = await reverseGeocode(lat, lng)
      if (p) apply({ ...p, number: p.number || form.number })
    } catch {
      /* mantém os campos; só as coordenadas mudaram */
    }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return setNote({ text: 'Seu navegador não permite obter a localização.', error: true })
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const p = await reverseGeocode(coords.latitude, coords.longitude)
          if (p) apply(p)
          else setForm((f) => ({ ...f, lat: coords.latitude, lng: coords.longitude }))
        } catch {
          setForm((f) => ({ ...f, lat: coords.latitude, lng: coords.longitude }))
        } finally {
          setBusy(false)
        }
      },
      () => {
        setBusy(false)
        setNote({ text: 'Não conseguimos pegar sua localização. Verifique a permissão do navegador.', error: true })
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const onSearchKey = (e) => {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active >= 0 ? active : 0])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    onSave({
      ...form,
      label: form.label.trim(),
      street: form.street.trim(),
      number: form.number.trim(),
      complement: form.complement.trim(),
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
    })
  }

  return (
    <dialog
      ref={ref}
      className="addr-dialog"
      aria-labelledby="addr-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
    >
      <form onSubmit={submit}>
        <header>
          <h2 id="addr-title">{editing ? 'Editar endereço' : 'Novo endereço'}</h2>
          <button type="button" className="addr-x" aria-label="Fechar" onClick={() => ref.current.close()}>
            ×
          </button>
        </header>
        <div className="addr-body">
          <div className="field addr-search">
            <label htmlFor="addr-q">Buscar endereço</label>
            <input
              id="addr-q"
              type="search"
              role="combobox"
              aria-expanded={open && results.length > 0}
              aria-controls="addr-list"
              aria-autocomplete="list"
              autoComplete="off"
              placeholder="Digite a rua, o número ou o CEP…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              onFocus={() => results.length && setOpen(true)}
              onBlur={() => setOpen(false)}
            />
            {open && results.length > 0 && (
              <ul id="addr-list" role="listbox" className="addr-list">
                {results.map((s, i) => (
                  <li key={s.id} role="option" aria-selected={i === active} className={i === active ? 'on' : undefined} onMouseDown={() => choose(s)} onMouseEnter={() => setActive(i)}>
                    <strong>{s.main}</strong>
                    {s.secondary && <span>{s.secondary}</span>}
                  </li>
                ))}
              </ul>
            )}
            <span className="hint">
              <button type="button" className="addr-link" onClick={useMyLocation}>
                Usar minha localização
              </button>
              {busy && <span className="muted"> Buscando…</span>}
              {!googleActive() && <span className="muted"> · busca via OpenStreetMap</span>}
            </span>
          </div>
          {note && (
            <p className={`form-msg ${note.error ? 'error' : ''}`} role="status">
              {note.text}
            </p>
          )}
          {position && (
            <div className="field">
              <AddressMap position={position} onMove={fromPin} />
              <span className="muted">Arraste o pin para ajustar o ponto de entrega.</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="addr-label">Nome do endereço</label>
            <input id="addr-label" required list="addr-labels" placeholder="Casa, Trabalho…" value={form.label} onChange={set('label')} maxLength={30} />
            <datalist id="addr-labels">
              <option value="Casa" />
              <option value="Trabalho" />
              <option value="Outro" />
            </datalist>
          </div>
          <div className="addr-row">
            <div className="field addr-grow">
              <label htmlFor="addr-street">Rua / avenida</label>
              <input id="addr-street" ref={streetRef} required value={form.street} onChange={set('street')} />
            </div>
            <div className="field addr-sm">
              <label htmlFor="addr-number">Número</label>
              <input id="addr-number" ref={numberRef} required placeholder="s/n" value={form.number} onChange={set('number')} />
            </div>
          </div>
          <div className="addr-row">
            <div className="field addr-grow">
              <label htmlFor="addr-comp">Complemento</label>
              <input id="addr-comp" placeholder="Apto, bloco, referência…" value={form.complement} onChange={set('complement')} />
            </div>
            <div className="field addr-grow">
              <label htmlFor="addr-nb">Bairro</label>
              <input id="addr-nb" required value={form.neighborhood} onChange={set('neighborhood')} />
            </div>
          </div>
          <div className="addr-row">
            <div className="field addr-grow">
              <label htmlFor="addr-city">Cidade</label>
              <input id="addr-city" required value={form.city} onChange={set('city')} />
            </div>
            <div className="field addr-xs">
              <label htmlFor="addr-uf">UF</label>
              <input id="addr-uf" required maxLength={2} value={form.state} onChange={set('state')} style={{ textTransform: 'uppercase' }} />
            </div>
            <div className="field addr-sm">
              <label htmlFor="addr-zip">CEP</label>
              <input id="addr-zip" inputMode="numeric" placeholder="00000-000" value={form.zip} onChange={(e) => {
                  const zip = maskZip(e.target.value)
                  setForm((f) => ({ ...f, zip }))
                  if (zip.length === 9 && zip !== form.zip) fillFromCep(zip)
                }}
              />
            </div>
          </div>
          <label className="addr-check">
            <input type="checkbox" checked={form.primary} onChange={(e) => setForm((f) => ({ ...f, primary: e.target.checked }))} /> Usar como endereço principal
          </label>
        </div>
        <footer>
          {editing && canRemove && (
            <button type="button" className="btn ghost sm addr-remove" onClick={() => onRemove(address.id)}>
              Remover
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => ref.current.close()}>
            Cancelar
          </button>
          <button type="submit" className="btn">
            Salvar endereço
          </button>
        </footer>
      </form>
    </dialog>
  )
}

export default AddressDialog
