import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { DELIVERY_STATUS, VEHICLE_LABEL, distanceMeters, formatDistance, trackOrderDelivery } from '../lib/delivery'
import { formatBRL } from '../lib/format'
import { useRealtime } from '../lib/realtime'

const TrackMap = lazy(() => import('./TrackMap'))

// Entrega do pedido (Acompanhar): status, PIN para mostrar ao entregador e posição em tempo real.
function DeliveryTracker({ orderId, orderStatus }) {
  const { token } = useAuth()
  const [info, setInfo] = useState(null)
  const [live, setLive] = useState(null) // posição recebida pelo socket, mais nova que a do GET

  const load = useCallback(async () => {
    try {
      setInfo(await trackOrderDelivery(orderId))
    } catch (err) {
      console.error('Entrega: falha ao carregar', err)
    }
  }, [orderId])
  useEffect(() => {
    load()
  }, [load, orderStatus])
  // Sem socket (ou entre eventos), atualiza a cada 15 s enquanto a corrida está em andamento.
  useEffect(() => {
    const open = info?.delivery && ['REQUESTED', 'OFFERED', 'ACCEPTED', 'PICKED_UP'].includes(info.delivery.status)
    if (!open) return undefined
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [info?.delivery?.status, load])

  useRealtime(token, {
    'delivery:location': (p) => info?.delivery?.id === p.deliveryId && setLive({ lat: p.lat, lng: p.lng }),
  })

  if (!info || info.fulfillment === 'PICKUP') return null
  const d = info.delivery
  const [tone, label] = d ? DELIVERY_STATUS[d.status] ?? ['off', d.status] : ['prep', 'Aguardando a loja chamar o entregador']
  const courierPos = live ?? (info.courier?.lat != null ? { lat: info.courier.lat, lng: info.courier.lng } : null)
  const active = d && ['ACCEPTED', 'PICKED_UP'].includes(d.status)
  const away = courierPos && info.dropoff ? distanceMeters(courierPos, info.dropoff) : null

  return (
    <section className="panel" aria-label="Entrega" style={{ marginTop: 20 }}>
      <h3>Entrega no bairro</h3>
      <p>
        <span className={`tag ${tone}`}>{label}</span>{' '}
        <span className="muted">Taxa de entrega: {formatBRL(info.deliveryFee)}</span>
      </p>
      {info.courier && (
        <p className="muted">
          Entregador: <strong>{info.courier.name}</strong> ({VEHICLE_LABEL[info.courier.vehicle] ?? info.courier.vehicle})
          {away != null && active && <> · a {formatDistance(away)} do seu endereço</>}
        </p>
      )}
      {d?.pinCode && (
        <div className="deal-notice ok" role="status">
          PIN da entrega: <strong style={{ fontSize: '1.4rem', letterSpacing: 4 }}>{d.pinCode}</strong>
          <br />
          <span style={{ fontWeight: 400 }}>Diga estes 4 números ao entregador só quando receber o pedido.</span>
        </div>
      )}
      {d?.pinLocked && <p className="form-msg error">Entrega travada por PIN errado. A loja vai liberar e gerar um novo PIN.</p>}
      {active && (info.store || courierPos) && (
        <Suspense fallback={<p className="muted">Carregando mapa…</p>}>
          <TrackMap store={info.store} dropoff={info.dropoff} courier={courierPos} />
        </Suspense>
      )}
    </section>
  )
}

export default DeliveryTracker
