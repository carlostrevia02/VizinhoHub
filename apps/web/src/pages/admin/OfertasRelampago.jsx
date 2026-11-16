import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { cancelFlash, createFlash, listMyFlash, useCountdown } from '../../lib/flash'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STATUS = {
  ACTIVE: ['ok', 'No ar'],
  SOLD_OUT: ['prep', 'Esgotada'],
  ENDED: ['off', 'Encerrada'],
  CANCELLED: ['off', 'Cancelada'],
  SCHEDULED: ['new', 'Agendada'],
}
const EMPTY = { productId: '', offerPrice: '', qtyTotal: '10', maxPerCustomer: '2', radiusM: '2000', durationMin: '60' }

function Remaining({ offer }) {
  const { text } = useCountdown(offer.endsAt)
  return offer.status === 'ACTIVE' ? <>{text}</> : <>—</>
}

// Tá Quentinho: o lojista cria ofertas relâmpago (preço agressivo, poucas unidades, prazo curto).
export default function OfertasRelampago() {
  useDocumentTitle('Ofertas relâmpago — VizinhoHub Manager')
  const { notify, products } = useAdmin()
  const [offers, setOffers] = useState(null) // null = carregando
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelingId, setCancelingId] = useState(null)

  const reload = useCallback(async () => {
    try {
      setOffers(await listMyFlash())
      setLoadError('')
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const live = useMemo(() => new Set((offers ?? []).filter((o) => o.status === 'ACTIVE').map((o) => o.productId)), [offers])
  const options = (products ?? []).filter((p) => p.active && p.stockQty > 0 && !live.has(p.id))
  const chosen = (products ?? []).find((p) => p.id === form.productId)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const body = {
      productId: form.productId,
      offerPrice: Number(String(form.offerPrice).replace(',', '.')),
      qtyTotal: Number(form.qtyTotal),
      maxPerCustomer: Number(form.maxPerCustomer),
      radiusM: Number(form.radiusM),
      durationMin: Number(form.durationMin),
    }
    const problem =
      (!body.productId && 'Escolha o produto.') ||
      (!(body.offerPrice > 0) && 'Informe o preço da oferta.') ||
      (chosen && body.offerPrice >= chosen.effectivePrice && `O preço da oferta precisa ser menor que ${formatBRL(chosen.effectivePrice)}.`) ||
      (!Number.isInteger(body.qtyTotal) || body.qtyTotal < 1 || body.qtyTotal > 1000 ? 'A quantidade deve ser de 1 a 1000.' : '') ||
      (chosen && body.qtyTotal > chosen.stockQty && `A quantidade é maior que o estoque (${chosen.stockQty}).`) ||
      (!Number.isInteger(body.maxPerCustomer) || body.maxPerCustomer < 1 || body.maxPerCustomer > 20 ? 'O máximo por cliente deve ser de 1 a 20.' : '') ||
      (!Number.isInteger(body.radiusM) || body.radiusM < 100 || body.radiusM > 10000 ? 'O raio deve ser de 100 a 10.000 metros.' : '') ||
      (!Number.isInteger(body.durationMin) || body.durationMin < 5 || body.durationMin > 720 ? 'A duração deve ser de 5 a 720 minutos.' : '')
    if (problem) return setError(problem)

    setError('')
    setSending(true)
    try {
      await createFlash(body)
      setForm(EMPTY)
      notify('Oferta no ar', 'Quem pediu alerta por perto vai ser avisado.')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  async function cancel(o) {
    if (!window.confirm(`Cancelar a oferta de ${o.productName}?`)) return
    setCancelingId(o.id)
    try {
      await cancelFlash(o.id)
      notify('Oferta cancelada', o.productName)
      await reload()
    } catch (err) {
      notify('Não foi possível cancelar', errorMessage(err), 'error')
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <>
      <h1 className="page-title">Ofertas relâmpago</h1>
      <p className="sub">
        Crie uma oferta com preço agressivo, poucas unidades e prazo curto. Clientes por perto veem no radar “Tá Quentinho” e quem
        pediu alerta recebe um aviso.
      </p>

      <section className="panel" style={{ marginBottom: 20 }}>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="fo-prod">Produto</label>
            <select id="fo-prod" value={form.productId} onChange={set('productId')} required>
              <option value="">{products === null ? 'Carregando produtos…' : 'Escolha…'}</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {formatBRL(p.effectivePrice)} · {p.stockQty} em estoque</option>
              ))}
            </select>
          </div>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="fo-price">Preço da oferta (R$)</label>
              <input id="fo-price" inputMode="decimal" value={form.offerPrice} onChange={set('offerPrice')} placeholder="Ex.: 3,99" />
            </div>
            <div className="field">
              <label htmlFor="fo-qty">Quantidade (1 a 1000)</label>
              <input id="fo-qty" type="number" min="1" max="1000" value={form.qtyTotal} onChange={set('qtyTotal')} />
            </div>
            <div className="field">
              <label htmlFor="fo-max">Máximo por cliente (1 a 20)</label>
              <input id="fo-max" type="number" min="1" max="20" value={form.maxPerCustomer} onChange={set('maxPerCustomer')} />
            </div>
            <div className="field">
              <label htmlFor="fo-radius">Raio de alcance (100 a 10.000 m)</label>
              <input id="fo-radius" type="number" min="100" max="10000" step="100" value={form.radiusM} onChange={set('radiusM')} />
            </div>
            <div className="field">
              <label htmlFor="fo-dur">Duração (5 a 720 min)</label>
              <input id="fo-dur" type="number" min="5" max="720" value={form.durationMin} onChange={set('durationMin')} />
            </div>
          </div>
          {error && <p className="deal-notice err" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={sending}>{sending ? 'Publicando…' : 'Publicar oferta'}</button>
        </form>
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Minhas ofertas</h2>
      {loadError ? (
        <p className="muted">
          {loadError} <button className="btn sm" type="button" onClick={reload}>Tentar de novo</button>
        </p>
      ) : offers === null ? (
        <p className="muted">Carregando ofertas…</p>
      ) : offers.length === 0 ? (
        <p className="muted">Nenhuma oferta relâmpago ainda.</p>
      ) : (
        <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Preço</th>
                <th>Vendidas</th>
                <th>Restam</th>
                <th>Tempo</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const [tone, label] = STATUS[o.status] ?? ['off', o.status]
                return (
                  <tr key={o.id}>
                    <td>
                      {o.productName}
                      <br />
                      <span className="muted">raio {o.radiusM} m · máx. {o.maxPerCustomer} por cliente</span>
                    </td>
                    <td>
                      {formatBRL(o.offerPrice)}
                      <br />
                      <span className="muted"><s>{formatBRL(o.originalPrice)}</s></span>
                    </td>
                    <td>{o.sold} de {o.qtyTotal}</td>
                    <td>{o.qtyAvailable}</td>
                    <td><Remaining offer={o} /></td>
                    <td><span className={`tag ${tone}`}>{label}</span></td>
                    <td>
                      {o.status === 'ACTIVE' && (
                        <button className="btn ghost sm" type="button" disabled={cancelingId === o.id} onClick={() => cancel(o)}>
                          {cancelingId === o.id ? 'Cancelando…' : 'Cancelar'}
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
