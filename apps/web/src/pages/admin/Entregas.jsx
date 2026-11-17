import { useCallback, useEffect, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { DELIVERY_STATUS, callCourier, getDeliveryConfig, listDeliveryOrders, ownFleetDeliver, ownFleetPickup, saveDeliveryConfig, unlockDeliveryPin } from '../../lib/delivery'
import { formatBRL } from '../../lib/format'
import { formatWhen, orderCode } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const OPEN = ['REQUESTED', 'OFFERED', 'ACCEPTED', 'PICKED_UP']
const ORDER_LABEL = { PENDING: 'Novo', IN_PREPARATION: 'Em preparo', READY: 'Pronto', COMPLETED: 'Concluído', CANCELLED: 'Cancelado' }

// Entregas: configuração (raio, taxa, frota) e pedidos com entrega (chamar entregador, status, liberar PIN).
export default function Entregas() {
  useDocumentTitle('Entregas — VizinhoHub Manager')
  const { notify } = useAdmin()
  const [cfg, setCfg] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [pins, setPins] = useState({})
  const [pinErrors, setPinErrors] = useState({})

  const reload = useCallback(async () => {
    try {
      setRows(await listDeliveryOrders())
      setLoadError('')
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    getDeliveryConfig()
      .then((c) => {
        setCfg(c)
        setForm({ ...c, deliveryFee: String(c.deliveryFee).replace('.', ',') })
      })
      .catch((err) => setFormError(errorMessage(err)))
    reload()
  }, [reload])
  // Acompanha as corridas: o status muda quando o entregador aceita/entrega.
  useEffect(() => {
    const t = setInterval(reload, 10_000)
    return () => clearInterval(t)
  }, [reload])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save(e) {
    e.preventDefault()
    const body = {
      deliveryEnabled: form.deliveryEnabled,
      hasOwnFleet: form.hasOwnFleet,
      deliveryRadiusM: Number(form.deliveryRadiusM),
      deliveryFee: Number(String(form.deliveryFee).replace(',', '.')),
    }
    if (!Number.isInteger(body.deliveryRadiusM) || body.deliveryRadiusM < 100 || body.deliveryRadiusM > 10000) return setFormError('O raio deve ser de 100 a 10.000 metros.')
    if (!(body.deliveryFee >= 0)) return setFormError('Informe uma taxa válida (pode ser 0).')
    setFormError('')
    setSaving(true)
    try {
      const saved = await saveDeliveryConfig(body)
      setCfg(saved)
      notify('Entrega salva', saved.deliveryEnabled ? 'Sua loja aceita pedidos para entrega.' : 'A entrega está desligada.')
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function call(r) {
    setBusyId(r.orderId)
    try {
      const res = await callCourier(r.orderId)
      notify('Entregador chamado', res.offered ? `${res.offered} entregador(es) por perto foram avisados.` : cfg?.hasOwnFleet ? 'Frota própria: a entrega ficou registrada.' : 'Nenhum entregador disponível por perto agora.', res.offered || cfg?.hasOwnFleet ? 'ok' : 'error')
      await reload()
    } catch (err) {
      notify('Não foi possível chamar', errorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function dispatchOwn(r) {
    setBusyId(r.orderId)
    try {
      await ownFleetPickup(r.deliveryId)
      notify('Saiu para entrega', 'O cliente já vê que o pedido está a caminho.')
      await reload()
    } catch (err) {
      notify('Não foi possível despachar', errorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmOwn(r) {
    const pin = (pins[r.orderId] ?? '').trim()
    if (!/^\d{4}$/.test(pin)) return setPinErrors((p) => ({ ...p, [r.orderId]: 'O PIN tem 4 dígitos.' }))
    setBusyId(r.orderId)
    try {
      await ownFleetDeliver(r.deliveryId, pin)
      setPins((p) => ({ ...p, [r.orderId]: '' }))
      setPinErrors((p) => ({ ...p, [r.orderId]: '' }))
      notify('Entrega confirmada', 'Pedido concluído.')
    } catch (err) {
      setPinErrors((p) => ({ ...p, [r.orderId]: errorMessage(err) }))
    } finally {
      setBusyId(null)
      await reload()
    }
  }

  async function unlock(r) {
    if (!window.confirm('Liberar a entrega? Um novo PIN será gerado para o cliente.')) return
    setBusyId(r.orderId)
    try {
      await unlockDeliveryPin(r.deliveryId)
      notify('Entrega liberada', 'O cliente recebeu um novo PIN no app.')
      await reload()
    } catch (err) {
      notify('Não foi possível liberar', errorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <h1 className="page-title">Entregas</h1>
      <p className="sub">
        Defina a área e a taxa de entrega e chame entregadores do bairro para os pedidos prontos. O entregador é autônomo: o acerto
        do repasse é direto com você, a plataforma só registra o valor.
      </p>

      <section className="panel" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Configuração de entrega</h3>
        {!form ? (
          <p className="muted">{formError || 'Carregando…'}</p>
        ) : (
          <form onSubmit={save} noValidate>
            <div className="field">
              <label>
                <input type="checkbox" checked={form.deliveryEnabled} onChange={set('deliveryEnabled')} /> Aceitar pedidos com entrega
              </label>
            </div>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="en-raio">Raio de entrega (100 a 10.000 m)</label>
                <input id="en-raio" type="number" min="100" max="10000" step="100" value={form.deliveryRadiusM} onChange={set('deliveryRadiusM')} />
              </div>
              <div className="field">
                <label htmlFor="en-taxa">Taxa de entrega (R$)</label>
                <input id="en-taxa" inputMode="decimal" value={form.deliveryFee} onChange={set('deliveryFee')} />
              </div>
              <div className="field">
                <label htmlFor="en-frota">Quem entrega</label>
                <select id="en-frota" value={form.hasOwnFleet ? 'own' : 'pool'} onChange={(e) => setForm((f) => ({ ...f, hasOwnFleet: e.target.value === 'own' }))}>
                  <option value="pool">Entregadores do bairro (pool)</option>
                  <option value="own">Frota própria</option>
                </select>
              </div>
            </div>
            {formError && <p className="deal-notice err" role="alert">{formError}</p>}
            <button className="btn" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </form>
        )}
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Pedidos com entrega</h2>
      {loadError ? (
        <p className="muted">
          {loadError} <button className="btn sm" type="button" onClick={reload}>Tentar de novo</button>
        </p>
      ) : rows === null ? (
        <p className="muted">Carregando pedidos…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nenhum pedido com entrega ainda.</p>
      ) : (
        <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Endereço</th>
                <th>Valores</th>
                <th>Pedido</th>
                <th>Entrega</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [tone, label] = r.deliveryStatus ? DELIVERY_STATUS[r.deliveryStatus] ?? ['off', r.deliveryStatus] : ['off', '—']
                const canCall = r.orderStatus === 'READY' && !r.deliveryId
                return (
                  <tr key={r.orderId}>
                    <td>
                      #{orderCode(r.orderId)}
                      <br />
                      <span className="muted">{r.customerName ?? 'Cliente'} · {formatWhen(r.createdAt)}</span>
                    </td>
                    <td>{r.deliveryAddress ?? '—'}</td>
                    <td>
                      {formatBRL(r.totalPrice)}
                      <br />
                      <span className="muted">+ entrega {formatBRL(r.deliveryFee)}</span>
                    </td>
                    <td><span className="tag prep">{ORDER_LABEL[r.orderStatus] ?? r.orderStatus}</span></td>
                    <td>
                      <span className={`tag ${tone}`}>{label}</span>
                      {r.courierName && <><br /><span className="muted">{r.courierName}</span></>}
                      {r.pinLocked && OPEN.includes(r.deliveryStatus) && <><br /><span className="tag low">PIN travado</span></>}
                    </td>
                    <td>
                      {canCall && (
                        <button className="btn sm" type="button" disabled={busyId === r.orderId} onClick={() => call(r)}>
                          {busyId === r.orderId ? 'Chamando…' : 'Chamar entregador'}
                        </button>
                      )}
                      {!canCall && !r.deliveryId && r.orderStatus !== 'READY' && r.orderStatus !== 'COMPLETED' && r.orderStatus !== 'CANCELLED' && <span className="muted">Deixe o pedido pronto primeiro</span>}
                      {r.ownFleet && r.deliveryStatus === 'REQUESTED' && (
                        <button className="btn sm" type="button" disabled={busyId === r.orderId} onClick={() => dispatchOwn(r)}>
                          {busyId === r.orderId ? 'Salvando…' : 'Saiu para entrega'}
                        </button>
                      )}
                      {r.ownFleet && r.deliveryStatus === 'PICKED_UP' && !r.pinLocked && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <input
                            aria-label={`PIN do cliente do pedido ${orderCode(r.orderId)}`}
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="PIN do cliente"
                            style={{ width: 120 }}
                            value={pins[r.orderId] ?? ''}
                            onChange={(e) => setPins((p) => ({ ...p, [r.orderId]: e.target.value.replace(/\D/g, '') }))}
                          />
                          <button className="btn sm" type="button" disabled={busyId === r.orderId} onClick={() => confirmOwn(r)}>
                            {busyId === r.orderId ? 'Confirmando…' : 'Confirmar entrega'}
                          </button>
                        </div>
                      )}
                      {r.ownFleet && pinErrors[r.orderId] && <p className="deal-notice err" role="alert" style={{ margin: '6px 0 0' }}>{pinErrors[r.orderId]}</p>}
                      {r.pinLocked && OPEN.includes(r.deliveryStatus) && (
                        <button className="btn ghost sm" type="button" disabled={busyId === r.orderId} onClick={() => unlock(r)}>
                          Liberar PIN
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
