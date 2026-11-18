import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { ApiError } from '../../lib/api'
import {
  VEHICLE_LABEL,
  acceptDelivery,
  confirmDelivery,
  declineDelivery,
  failDelivery,
  formatDistance,
  getActiveDelivery,
  getCourier,
  listCourierOffers,
  pickUpDelivery,
  registerCourier,
  sendCourierLocation,
  setCourierStatus,
} from '../../lib/delivery'
import { getPosition } from '../../lib/flash'
import { formatBRL } from '../../lib/format'
import { useRealtime } from '../../lib/realtime'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const msg = (err) => (err instanceof ApiError ? err.message : 'Algo deu errado. Tente novamente.')
const SEND_EVERY_MS = 5000

// Área do entregador: perfil, disponível/offline, convites, corrida ativa e PIN.
function Entregador() {
  useDocumentTitle('Entregador — VizinhoHub')
  const { token, user } = useAuth()
  const [courier, setCourier] = useState(undefined) // undefined = carregando, null = sem perfil
  const [offers, setOffers] = useState([])
  const [active, setActive] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setCourier(await getCourier())
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_A_COURIER') return setCourier(null)
      return setError(msg(err))
    }
    try {
      const [o, a] = await Promise.all([listCourierOffers(), getActiveDelivery()])
      setOffers(o)
      setActive(a)
    } catch (err) {
      setError(msg(err))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])
  // Convites expiram em 2 min: reconsulta de tempos em tempos (e o socket traz os novos na hora).
  useEffect(() => {
    if (!courier) return undefined
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [courier?.userId, refresh])
  useRealtime(token, { 'delivery:offered': () => refresh() })

  // Disponível e sem corrida: avisa a posição de tempos em tempos (é com ela que a loja encontra você).
  useEffect(() => {
    if (courier?.status !== 'AVAILABLE') return undefined
    const ping = async () => {
      try {
        await sendCourierLocation(await getPosition())
      } catch {}
    }
    ping()
    const t = setInterval(ping, 30_000)
    return () => clearInterval(t)
  }, [courier?.status])

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(msg(err))
      refresh()
    } finally {
      setBusy(false)
    }
  }

  if (courier === undefined) return <main><p className="muted">Carregando…</p></main>

  if (courier === null) return <Register onDone={refresh} />

  return (
    <main>
      <h1 className="page-title">Área do entregador</h1>
      <p className="sub">
        {user?.name} · {VEHICLE_LABEL[courier.vehicle]} · {courier.neighborhood}, {courier.city} · {courier.deliveriesDone} entrega(s)
      </p>
      {error && <p className="form-msg error" role="alert">{error}</p>}

      <section className="panel" style={{ marginBottom: 20 }}>
        <p>
          Status: <span className={`tag ${courier.status === 'OFFLINE' ? 'off' : courier.status === 'BUSY' ? 'prep' : 'ok'}`}>{{ OFFLINE: 'Offline', AVAILABLE: 'Disponível', BUSY: 'Em corrida' }[courier.status]}</span>
        </p>
        {courier.status !== 'BUSY' && (
          <button className="btn" type="button" disabled={busy} onClick={() => run(() => setCourierStatus(courier.status === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE'))}>
            {courier.status === 'AVAILABLE' ? 'Ficar offline' : 'Ficar disponível'}
          </button>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          O acerto do repasse é direto com o lojista. Sua posição só é enviada enquanto você está disponível ou numa corrida.
        </p>
      </section>

      {active ? (
        <ActiveRun key={active.id} run={active} busy={busy} onAction={run} />
      ) : (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Convites</h3>
          {courier.status !== 'AVAILABLE' ? (
            <p className="muted">Fique disponível para receber convites de corrida.</p>
          ) : offers.length === 0 ? (
            <p className="muted">Nenhum convite agora. Avisamos assim que uma loja por perto chamar.</p>
          ) : (
            offers.map((o) => (
              <div className="line" key={o.deliveryId}>
                <span>
                  <strong>{o.storeName}</strong>
                  <br />
                  <span className="muted">
                    {formatDistance(o.distanceM)} da loja · repasse {formatBRL(o.courierFee)} · até {new Date(o.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <span>
                  <button className="btn sm" type="button" disabled={busy} onClick={() => run(() => acceptDelivery(o.deliveryId))}>Aceitar</button>{' '}
                  <button className="btn ghost sm" type="button" disabled={busy} onClick={() => run(() => declineDelivery(o.deliveryId))}>Recusar</button>
                </span>
              </div>
            ))
          )}
        </section>
      )}
    </main>
  )
}

function Register({ onDone }) {
  useDocumentTitle('Ser entregador — VizinhoHub')
  const [form, setForm] = useState({ vehicle: 'MOTO', neighborhood: '', city: 'Fortaleza' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (!form.neighborhood.trim() || !form.city.trim()) return setError('Informe o bairro e a cidade.')
    setBusy(true)
    setError('')
    try {
      await registerCourier({ vehicle: form.vehicle, neighborhood: form.neighborhood.trim(), city: form.city.trim() })
      await onDone()
    } catch (err) {
      setError(msg(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main>
      <h1 className="page-title">Seja entregador do bairro</h1>
      <p className="sub">Receba convites das lojas por perto. Você é autônomo e acerta o valor direto com o lojista.</p>
      <section className="panel">
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="ve">Veículo</label>
            <select id="ve" value={form.vehicle} onChange={set('vehicle')}>
              {Object.entries(VEHICLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ba">Bairro-base</label>
            <input id="ba" value={form.neighborhood} onChange={set('neighborhood')} placeholder="Ex.: Aldeota" />
          </div>
          <div className="field">
            <label htmlFor="ci">Cidade</label>
            <input id="ci" value={form.city} onChange={set('city')} />
          </div>
          {error && <p className="form-msg error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Cadastrar'}</button>{' '}
          <Link className="btn ghost" to="/">Voltar</Link>
        </form>
      </section>
    </main>
  )
}

// Corrida em andamento: envia o GPS (watchPosition) só enquanto ela existe, no máximo a cada 5 s.
function ActiveRun({ run, busy, onAction }) {
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [failing, setFailing] = useState(false)
  const last = useRef(0)

  useEffect(() => {
    if (!('geolocation' in navigator)) return undefined
    const id = navigator.geolocation.watchPosition(
      async (p) => {
        const now = Date.now()
        if (now - last.current < SEND_EVERY_MS) return
        last.current = now
        try {
          await sendCourierLocation({ lat: p.coords.latitude, lng: p.coords.longitude })
        } catch {}
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  const picked = run.status === 'PICKED_UP'
  const maps = (p) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`

  return (
    <section className="panel">
      <h3 style={{ marginTop: 0 }}>Corrida em andamento</h3>
      <p>
        <span className="tag new">{picked ? 'Entregando ao cliente' : 'Indo buscar na loja'}</span>{' '}
        <span className="muted">repasse {formatBRL(run.courierFee)} · {formatDistance(run.distanceM)}</span>
      </p>
      <p>
        <strong>{run.storeName}</strong> · <a href={maps(run.pickup)} target="_blank" rel="noreferrer">ver loja no mapa</a>
        <br />
        Cliente: {run.customerName ?? '—'}{run.phone ? ` · ${run.phone}` : ''}
        <br />
        Endereço: {run.deliveryAddress ?? '—'} · <a href={maps(run.dropoff)} target="_blank" rel="noreferrer">ver destino no mapa</a>
      </p>
      {!picked ? (
        <button className="btn" type="button" disabled={busy} onClick={() => onAction(() => pickUpDelivery(run.id))}>Peguei o pedido na loja</button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onAction(async () => {
              await confirmDelivery(run.id, pin)
              setPin('')
            })
          }}
        >
          <div className="field">
            <label htmlFor="pin">PIN que o cliente mostra no app (4 dígitos)</label>
            <input id="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </div>
          <button className="btn" type="submit" disabled={busy || pin.length !== 4}>Concluir entrega</button>
        </form>
      )}
      <p style={{ marginTop: 16 }}>
        {failing ? (
          <>
            <input aria-label="Motivo" placeholder="Motivo (ex.: cliente ausente)" value={reason} onChange={(e) => setReason(e.target.value)} />{' '}
            <button className="btn ghost sm" type="button" disabled={busy || !reason.trim()} onClick={() => onAction(() => failDelivery(run.id, reason.trim()))}>Confirmar problema</button>
          </>
        ) : (
          <button className="btn ghost sm" type="button" onClick={() => setFailing(true)}>Não consegui entregar</button>
        )}
      </p>
    </section>
  )
}

export default Entregador
