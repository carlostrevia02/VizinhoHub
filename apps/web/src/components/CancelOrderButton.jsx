import { useState } from 'react'

// Cancelar não tem volta (devolve saldo de oferta, estorna fiado e avisa o cliente): pede confirmação ali mesmo.
// Não usa window.confirm, que alguns navegadores embutidos bloqueiam.
function CancelOrderButton({ label = 'Cancelar', size = 'sm', busy, onConfirm }) {
  const [asking, setAsking] = useState(false)
  const sm = size === 'sm' ? ' sm' : ''

  if (!asking) {
    return (
      <button className={`btn danger${sm}`} type="button" disabled={busy} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span role="group" aria-label="Confirmar cancelamento" style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
      <strong>Cancelar este pedido?</strong>
      <button
        className={`btn danger${sm}`}
        type="button"
        disabled={busy}
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        Sim, cancelar
      </button>
      <button className={`btn ghost${sm}`} type="button" onClick={() => setAsking(false)}>
        Voltar
      </button>
    </span>
  )
}

export default CancelOrderButton
