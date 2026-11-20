import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { addressLine1, addressLine2, useAddresses } from '../lib/addresses'
import { refreshPosition, setDeliveryChoice, useNearbyLocation } from '../lib/useNearbyLocation'

const AddressDialog = lazy(() => import('./AddressDialog'))

const PencilIcon = () => (
  <svg className="loc-pencil" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

// Seletor "Onde entregar?": endereços salvos, localização atual e novo endereço.
function Picker({ userId, onClose, onNew }) {
  const ref = useRef(null)
  const { list } = useAddresses(userId)
  const current = useNearbyLocation(userId)
  useLayoutEffect(() => {
    ref.current.showModal()
  }, [])
  const pick = (id) => {
    if (!id) refreshPosition()
    setDeliveryChoice(userId, id)
    ref.current.close()
  }
  return (
    <dialog ref={ref} className="addr-dialog" aria-labelledby="loc-title" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <header>
        <h2 id="loc-title">Onde entregar?</h2>
        <button type="button" className="addr-x" aria-label="Fechar" onClick={() => ref.current.close()}>
          ×
        </button>
      </header>
      <div className="addr-body loc-options">
        <button type="button" className="loc-opt" aria-pressed={current.source === 'gps' || current.source === 'saved'} onClick={() => pick(null)}>
          <strong>Minha localização atual</strong>
          <span>Detectamos pelo aparelho; perto de um endereço seu, usamos o endereço.</span>
        </button>
        {list.map((a) => (
          <button type="button" key={a.id} className="loc-opt" aria-pressed={current.source === 'chosen' && current.address.id === a.id} onClick={() => pick(a.id)}>
            <strong>{a.label}</strong>
            <span>
              {addressLine1(a)} · {addressLine2(a)}
            </span>
          </button>
        ))}
      </div>
      <footer>
        <button type="button" className="btn ghost" onClick={() => ref.current.close()}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onNew()
            ref.current.close()
          }}
        >
          + Novo endereço
        </button>
      </footer>
    </dialog>
  )
}

// Texto do local de entrega com lápis: clicar abre o seletor para trocar.
function LocationButton({ prefix = '' }) {
  const { user } = useAuth()
  const location = useNearbyLocation(user?.id)
  const { save } = useAddresses(user?.id)
  const [mode, setMode] = useState(null) // null | 'pick' | 'new'
  // O seletor fecha "para dentro" do novo endereço: guardamos o destino para abrir o diálogo depois do close.
  const goNew = useRef(false)
  return (
    <>
      <button type="button" className="loc-btn" onClick={() => setMode('pick')} aria-haspopup="dialog" title="Alterar local de entrega">
        <span>
          {prefix}
          {location.text}
        </span>
        <PencilIcon />
        <span className="sr-only"> — alterar local de entrega</span>
      </button>
      {mode === 'pick' && (
        <Picker
          userId={user?.id}
          onNew={() => {
            goNew.current = true
          }}
          onClose={() => {
            setMode(goNew.current ? 'new' : null)
            goNew.current = false
          }}
        />
      )}
      {mode === 'new' && (
        <Suspense fallback={null}>
          <AddressDialog
            address={{}}
            canRemove={false}
            onClose={() => setMode(null)}
            onRemove={() => {}}
            onSave={(a) => {
              setDeliveryChoice(user?.id, save(a))
              setMode(null)
            }}
          />
        </Suspense>
      )}
    </>
  )
}

export default LocationButton
