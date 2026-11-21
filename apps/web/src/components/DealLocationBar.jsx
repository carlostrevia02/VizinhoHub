import { useState } from 'react'

// Origem das distâncias das ofertas. A localização só é pedida ao navegador no clique do botão.
// `location` vem de useClientLocation. Com o local de entrega já definido, só informa de onde partem as distâncias.
function DealLocationBar({ location }) {
  const { coords, source, label, request, clear } = location
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function use() {
    setBusy(true)
    setError('')
    const r = await request()
    if (!r.ok) setError(r.message)
    setBusy(false)
  }

  return (
    <div className="deal-loc">
      {!coords && (
        <button className="btn ghost sm" type="button" disabled={busy} onClick={use}>
          {busy ? 'Localizando…' : 'Usar minha localização'}
        </button>
      )}
      {!coords && !error && <span className="muted">Veja a filial mais próxima, a distância e o tempo de moto.</span>}
      {source === 'device' && (
        <>
          <span className="muted">Distâncias a partir da sua localização.</span>
          <button className="deal-loc-clear" type="button" onClick={clear}>Limpar localização</button>
        </>
      )}
      {source === 'delivery' && <span className="muted">Distâncias a partir de: {label}.</span>}
      <span className="deal-loc-msg" role="status" aria-live="polite">{error}</span>
    </div>
  )
}

export default DealLocationBar
