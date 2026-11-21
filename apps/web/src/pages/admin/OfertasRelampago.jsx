import { useCallback, useEffect, useMemo, useState } from 'react'
import ProductPicker from '../../components/ProductPicker'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { cancelFlash, createFlash, listMyFlash, useCountdown } from '../../lib/flash'
import { formatBRL } from '../../lib/format'
import { isoDay } from '../../lib/caderneta'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STATUS = {
  ACTIVE: ['ok', 'No ar'],
  SOLD_OUT: ['prep', 'Esgotada'],
  ENDED: ['off', 'Encerrada'],
  CANCELLED: ['off', 'Cancelada'],
  SCHEDULED: ['new', 'Agendada'],
}
const EMPTY = { productId: '', offerPrice: '', qtyTotal: '10', maxPerCustomer: '2', radiusM: '2000', durationMin: '60' }

// Uma linha da tabela. O status exibido deriva de `endsAt`: passou do prazo, é "Encerrada" (sem Cancelar),
// mesmo que a API ainda não tenha marcado a oferta; `onExpire` recarrega a lista nessa hora.
function OfferRow({ offer: o, canceling, onCancel, onExpire }) {
  const { text, expired } = useCountdown(o.endsAt)
  const status = o.status === 'ACTIVE' && expired ? 'ENDED' : o.status
  const [tone, label] = STATUS[status] ?? ['off', status]
  useEffect(() => {
    if (o.status === 'ACTIVE' && expired) onExpire()
  }, [o.status, expired]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <tr>
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
      <td>{status === 'ACTIVE' ? text : status === 'ENDED' ? 'Encerrada' : '—'}</td>
      <td><span className={`tag ${tone}`}>{label}</span></td>
      <td>
        {status === 'ACTIVE' && (
          <button className="btn ghost sm" type="button" disabled={canceling} onClick={() => onCancel(o)}>
            {canceling ? 'Cancelando…' : 'Cancelar'}
          </button>
        )}
      </td>
    </tr>
  )
}

// Tá Quentinho: o lojista cria ofertas relâmpago (preço agressivo, poucas unidades, prazo curto).
function OfertasRelampago() {
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

  const live = useMemo(() => new Set((offers ?? []).filter((o) => o.status === 'ACTIVE' && new Date(o.endsAt) > new Date()).map((o) => o.productId)), [offers])
  // Sem produto vencido (a API recusa) nem com preço 0.
  const options = useMemo(() => {
    const today = isoDay(0)
    return (products ?? []).filter((p) => p.active && !live.has(p.id) && p.effectivePrice > 0 && p.price > 0 && (!p.expirationDate || p.expirationDate >= today))
  }, [products, live])
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
      (!Number.isInteger(body.maxPerCustomer) || body.maxPerCustomer < 1 || body.maxPerCustomer > 20 ? 'O máximo por cliente deve ser de 1 a 20.' : '') ||
      (body.maxPerCustomer > body.qtyTotal && `O máximo por cliente (${body.maxPerCustomer}) não pode ser maior que a quantidade da oferta (${body.qtyTotal}).`) ||
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
      await reload() // a oferta pode já ter encerrado: mostra o estado real
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
            <ProductPicker
              id="fo-prod"
              products={products === null ? null : options}
              value={form.productId}
              onChange={(productId) => setForm((f) => ({ ...f, productId }))}
              getHint={(p) => formatBRL(p.effectivePrice)}
            />
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
              {offers.map((o) => (
                <OfferRow key={o.id} offer={o} canceling={cancelingId === o.id} onCancel={cancel} onExpire={reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default OfertasRelampago
