import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import { useCatalog } from '../../context/CatalogContext'
import { api, ApiError } from '../../lib/api'
import { formatDay, getAvailability, isoDay, listMyCredit } from '../../lib/caderneta'
import { imgSrc } from '../../lib/catalog'
import { getStoreDelivery } from '../../lib/delivery'
import { getPosition } from '../../lib/flash'
import '../../styles/caderneta.css'
import { formatBRL } from '../../lib/format'
import { track } from '../../lib/track'
import { useVipDiscount } from '../../lib/vip'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

export default function Carrinho() {
  useDocumentTitle('VizinhoHub Store — Carrinho')
  const { user, displayName } = useAuth()
  const { lines, setQty } = useCart()
  const { reload } = useCatalog()
  const location = useLocation()
  const [sent, setSent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState(null) // loja escolhida quando o carrinho mistura lojas
  // nome null = o cliente ainda não mexeu: usa o nome da conta (que pode chegar depois do 1º render).
  const [form, setForm] = useState({ nome: null, tel: '', ent: 'Retirar na loja', obs: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // Entrega no bairro (logística): taxa/raio da loja e a localização do endereço do cliente.
  const [shipCfg, setShipCfg] = useState(null)
  const [addr, setAddr] = useState('')
  const [pos, setPos] = useState(null)
  const [locating, setLocating] = useState(false)
  const nome = form.nome ?? displayName

  // A API aceita um pedido por loja: com itens de lojas diferentes, o cliente escolhe qual enviar agora.
  const merchants = [...new Map(lines.map((l) => [l.product.merchantId, l.product.store.name])).entries()]
  const merchantId = merchants.some(([id]) => id === chosen) ? chosen : merchants[0]?.[0]
  const storeName = merchants.find(([id]) => id === merchantId)?.[1]
  const orderLines = lines.filter((l) => l.product.merchantId === merchantId)
  useEffect(() => {
    setShipCfg(null)
    if (merchantId) getStoreDelivery(merchantId).then(setShipCfg).catch(() => {})
  }, [merchantId])
  const delivering = form.ent === 'Entrega no bairro'
  const useMyLocation = async () => {
    setLocating(true)
    setError('')
    try {
      setPos(await getPosition())
    } catch {
      setError('Não foi possível obter sua localização. Permita o acesso ao GPS do aparelho.')
    } finally {
      setLocating(false)
    }
  }
  useEffect(() => {
    if (merchantId) track('CHECKOUT_START', merchantId, undefined, { once: true })
  }, [merchantId])
  const orderTotal = Math.round(orderLines.reduce((s, l) => s + l.qty * l.product.price * 100, 0)) / 100
  // Clube VIP: estimativa do desconto (o valor final vem do servidor); ofertas relâmpago ficam de fora.
  const vip = useVipDiscount(merchantId, user?.role === 'CUSTOMER')
  const vipPct = vip.pct
  // Mesmo arredondamento do servidor (vip.discount.ts): desconto por unidade, em centavos, e depois × quantidade.
  const permille = Math.round(vipPct * 10)
  const vipSavings =
    orderLines
      .filter((l) => !l.product.flashOfferId)
      .reduce((s, l) => {
        const cents = Math.round(l.product.price * 100)
        return s + (cents - Math.round((cents * (1000 - permille)) / 1000)) * l.qty
      }, 0) / 100
  const subtotal = Math.round((orderTotal - vipSavings) * 100) / 100
  // Frete grátis VIP: mesma regra do servidor (loja banca o frete e o pedido, já com desconto, passa do mínimo do plano).
  const vipFreeShipping = vip.freeDeliveryMinOrder !== null && subtotal >= vip.freeDeliveryMinOrder
  const shippingOn = delivering && shipCfg?.deliveryEnabled
  const fee = shippingOn && !vipFreeShipping ? shipCfg.deliveryFee : 0

  // [caderneta · encomendas] forma "Pagar na caderneta" (se o cliente tem conta na loja) e agendamento de encomenda.
  const [payment, setPayment] = useState('')
  const [credit, setCredit] = useState(null) // conta do cliente na loja escolhida
  const [slots, setSlots] = useState(null) // vagas dos próximos dias; null = carregando
  const [pick, setPick] = useState({ slotKey: '', local: '', deposit: '' })
  const leadHours = Math.max(0, ...orderLines.map((l) => l.product.leadTimeHours ?? 0))
  const needsSchedule = leadHours > 0
  useEffect(() => {
    if (!user || !merchantId) return
    let alive = true
    listMyCredit()
      .then((all) => alive && setCredit(all.find((a) => a.merchantId === merchantId && a.status === 'ACTIVE') ?? null))
      .catch(() => alive && setCredit(null))
    return () => {
      alive = false
    }
  }, [user, merchantId])
  useEffect(() => {
    setPayment((p) => (p === 'credit' && !credit ? '' : p))
  }, [credit])
  useEffect(() => {
    if (!needsSchedule || !merchantId || !user) return
    let alive = true
    getAvailability(merchantId, isoDay(0), 14)
      .then((s) => alive && setSlots(s))
      .catch(() => alive && setSlots([]))
    return () => {
      alive = false
    }
  }, [needsSchedule, merchantId, user])
  const earliest = Date.now() + leadHours * 3_600_000
  const slotStart = (s) => `${s.date}T${s.startsAt}:00-03:00`
  const bookable = (slots ?? []).filter((s) => s.free > 0 && new Date(slotStart(s)).getTime() >= earliest)
  const slotKey = (s) => `${s.slotId}|${s.date}`
  const chosenSlot = bookable.find((s) => slotKey(s) === pick.slotKey)
  const depositValue = Number(String(pick.deposit).replace(',', '.')) || 0
  const scheduleBody = () => {
    if (!needsSchedule) return undefined
    if (slots?.length) return { scheduledFor: slotStart(chosenSlot), slotId: chosenSlot.slotId, depositAmount: depositValue }
    return { scheduledFor: new Date(pick.local).toISOString(), depositAmount: depositValue }
  }
  const scheduleReady = !needsSchedule || (slots?.length ? !!chosenSlot : !!pick.local && new Date(pick.local).getTime() >= earliest)

  const sendOrder = async (e) => {
    e.preventDefault()
    if (delivering && shipCfg?.deliveryEnabled && (!pos || addr.trim().length < 3)) {
      setError('Informe o endereço e toque em "Usar minha localização" para calcular a entrega.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const order = await api.post('/orders', {
        items: orderLines.map((l) => (l.product.flashOfferId ? { flashOfferId: l.product.flashOfferId, quantity: l.qty } : { productId: l.product.id, quantity: l.qty })),
        customerName: nome.trim() || undefined,
        phone: form.tel.trim() || undefined,
        deliveryMethod: form.ent,
        notes: form.obs.trim() || undefined,
        ...(delivering && shipCfg?.deliveryEnabled && { fulfillment: 'DELIVERY', deliveryAddress: addr.trim(), deliveryLat: pos.lat, deliveryLng: pos.lng }),
        paymentMethod: payment || undefined,
        schedule: scheduleBody(),
      })
      setSent({
        nome: nome.trim(),
        loja: storeName,
        total: order.totalPrice + fee,
        itens: order.items.reduce((n, i) => n + i.quantity, 0),
        id: order.id,
      })
      orderLines.forEach((l) => setQty(l.product.id, 0))
      reload() // o estoque mudou: a vitrine busca os números novos
    } catch (err) {
      console.error('Falha ao enviar pedido:', err)
      if (err instanceof ApiError && ['INSUFFICIENT_STOCK', 'FLASH_UNAVAILABLE', 'FLASH_LIMIT'].includes(err.code)) reload()
      setError(
        err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401
          ? err.message
          : err instanceof ApiError && err.code === 'NETWORK'
            ? err.message
            : 'Não foi possível enviar o pedido. Tente novamente em instantes.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <main>
        <h1 className="page-title">Pedido enviado!</h1>
        <p className="sub">
          Obrigado{sent.nome ? `, ${sent.nome}` : ''}. Recebemos {sent.itens} {sent.itens === 1 ? 'item' : 'itens'} no total de{' '}
          {formatBRL(sent.total)}. {sent.loja} vai confirmar em instantes. Pedido #{sent.id.slice(0, 6).toUpperCase()}.
        </p>
        <div className="stepper" aria-label="Progresso do pedido">
          <div className="done">1. Carrinho</div>
          <div className="done">2. Seus dados</div>
          <div className="done">3. Confirmação</div>
        </div>
        <Link className="btn" to={`/acompanhar/${sent.id}`}>Acompanhar pedido</Link>{' '}
        {lines.length > 0 && <Link className="btn ghost" to="/carrinho" onClick={() => setSent(null)}>Voltar ao carrinho</Link>}
      </main>
    )
  }

  if (lines.length === 0) {
    return (
      <main>
        <h1 className="page-title">Seu carrinho está vazio</h1>
        <p className="sub">Adicione produtos da vitrine para finalizar um pedido.</p>
        <Link className="btn" to="/produtos">Ver produtos</Link>
      </main>
    )
  }

  return (
    <main>
      <h1 className="page-title">Finalizar pedido</h1>
      <p className="sub">Confira os itens e informe seus dados. O estoque é validado no envio.</p>
      <div className="stepper" aria-label="Progresso do pedido">
        <div className="done">1. Carrinho</div>
        <div className="now">2. Seus dados</div>
        <div>3. Confirmação</div>
      </div>

      <div className="checkout">
        <section className="panel sk sk-lines" aria-label="Itens do carrinho">
          <h2 style={{ marginTop: 0 }}>Seu carrinho</h2>
          {merchants.length > 1 && (
            <div className="field">
              <label htmlFor="loja">Seu carrinho tem produtos de {merchants.length} lojas. Enviar agora o pedido de:</label>
              <select id="loja" value={merchantId} onChange={(e) => setChosen(e.target.value)}>
                {merchants.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <p className="muted" style={{ marginBottom: 0 }}>Os itens das outras lojas ficam no carrinho para um próximo pedido.</p>
            </div>
          )}
          {orderLines.map(({ product: p, qty }) => (
            <div className="line" key={p.id}>
              <span className="item">
                <img src={imgSrc(p)} alt="" width="96" height="96" loading="lazy" />
                <span>
                  {p.name}
                  {p.flashOfferId && <> <span className="tag new">Tá Quentinho</span></>}
                  <br />
                  <span className="muted">
                    {formatBRL(p.price)} cada
                    {p.flashOfferId && ` · máx. ${p.stock} por cliente`}
                  </span>
                </span>
              </span>
              <span className="qty">
                <button type="button" className="btn ghost sm" aria-label="Diminuir" onClick={() => setQty(p.id, qty - 1)}>−</button>
                <span>{qty}</span>
                <button type="button" className="btn ghost sm" aria-label="Aumentar" disabled={qty >= p.stock} onClick={() => setQty(p.id, qty + 1)}>+</button>
              </span>
              <strong>{formatBRL(p.price * qty)}</strong>
            </div>
          ))}
          {vipSavings > 0 && (
            <div className="line">
              <span><span className="tag ok">VIP</span> Selo Vizinho VIP ({vipPct}%)</span>
              <span>− {formatBRL(vipSavings)}</span>
            </div>
          )}
          <div className="line">
            <span className="total">Total{merchants.length > 1 ? ` · ${storeName}` : ''}</span>
            <span className="total">{formatBRL(subtotal)}</span>
          </div>
          {shippingOn && (
            <div className="line">
              <span>Taxa de entrega (até {(shipCfg.deliveryRadiusM / 1000).toFixed(1).replace('.', ',')} km)</span>
              {vipFreeShipping ? (
                <span><span className="tag ok">VIP</span> Grátis <s className="muted">{formatBRL(shipCfg.deliveryFee)}</s></span>
              ) : (
                <span>{formatBRL(fee)}</span>
              )}
            </div>
          )}
          {shippingOn && (
            <div className="line">
              <span className="total">Total com entrega</span>
              <span className="total">{formatBRL(subtotal + fee)}</span>
            </div>
          )}
        </section>

        <section className="panel sk sk-lines" style={{ '--i': 2 }} aria-label="Dados do pedido">
          <h2 style={{ marginTop: 0 }}>Seus dados</h2>
          <form onSubmit={sendOrder}>
            <div className="field">
              <label htmlFor="nome">Nome</label>
              <input id="nome" required value={nome} onChange={set('nome')} />
            </div>
            <div className="field">
              <label htmlFor="tel">WhatsApp</label>
              <input id="tel" required type="tel" placeholder="(85) 99999-0000" value={form.tel} onChange={set('tel')} />
            </div>
            <div className="field">
              <label htmlFor="ent">Retirada ou entrega</label>
              <select id="ent" value={form.ent} onChange={set('ent')}>
                <option>Retirar na loja</option>
                <option>Entrega no bairro</option>
              </select>
            </div>
            {delivering && shipCfg && !shipCfg.deliveryEnabled && <p className="form-msg error">Esta loja não está fazendo entregas. Escolha retirar na loja.</p>}
            {delivering && shipCfg?.deliveryEnabled && (
              <>
                <div className="field">
                  <label htmlFor="addr">Endereço de entrega</label>
                  <input id="addr" required value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Rua, número, complemento" />
                </div>
                <div className="field">
                  <button className="btn ghost sm" type="button" onClick={useMyLocation} disabled={locating}>
                    {locating ? 'Localizando…' : pos ? 'Localização obtida ✓ (atualizar)' : 'Usar minha localização'}
                  </button>
                  <span className="hint muted"> Precisamos do ponto no mapa para conferir se você está na área de entrega da loja.</span>
                </div>
              </>
            )}
            {needsSchedule && (
              <fieldset className="field" style={{ border: 0, padding: 0 }}>
                <legend><strong>Encomenda: escolha o dia e a faixa de retirada</strong></legend>
                <p className="muted" style={{ margin: '4px 0' }}>Este pedido precisa de {leadHours} h de antecedência.</p>
                {slots === null ? (
                  <p className="muted">Buscando horários…</p>
                ) : slots.length === 0 ? (
                  <input type="datetime-local" aria-label="Data e hora da retirada" value={pick.local} onChange={(e) => setPick((p) => ({ ...p, local: e.target.value }))} />
                ) : bookable.length === 0 ? (
                  <p className="form-msg error">Não há vagas nos próximos dias para essa antecedência.</p>
                ) : (
                  <div className="slot-list" role="radiogroup" aria-label="Faixa de retirada">
                    {bookable.map((s) => (
                      <label key={slotKey(s)}>
                        <span><input type="radio" name="slot" checked={pick.slotKey === slotKey(s)} onChange={() => setPick((p) => ({ ...p, slotKey: slotKey(s) }))} /> {formatDay(s.date)} · {s.startsAt}–{s.endsAt}</span>
                        <small className="muted">{s.free} {s.free === 1 ? 'vaga' : 'vagas'}</small>
                      </label>
                    ))}
                  </div>
                )}
                <label htmlFor="sinal">Sinal que você já combinou com a loja (opcional, R$)</label>
                <input id="sinal" inputMode="decimal" value={pick.deposit} onChange={(e) => setPick((p) => ({ ...p, deposit: e.target.value }))} placeholder="0,00" />
              </fieldset>
            )}
            <div className="pay-options" role="radiogroup" aria-label="Forma de pagamento">
              <label><input type="radio" name="pay" checked={payment === ''} onChange={() => setPayment('')} /> Combinar na retirada/entrega</label>
              {credit && (
                <label>
                  <input type="radio" name="pay" checked={payment === 'credit'} onChange={() => setPayment('credit')} />
                  <span>Pagar na caderneta <small className="muted">· disponível {formatBRL(credit.available)}{subtotal + fee - depositValue > credit.available ? ' (insuficiente para este pedido)' : ''}</small></span>
                </label>
              )}
            </div>
            <div className="field">
              <label htmlFor="obs">Observações</label>
              <textarea id="obs" rows="2" placeholder="Ex.: sem sacola plástica" value={form.obs} onChange={set('obs')} />
            </div>
            {error && <p className="form-msg error" role="alert">{error}</p>}
            {user ? (
              <button className="btn block" type="submit" disabled={busy || !scheduleReady}>
                {busy ? 'Enviando…' : 'Enviar pedido'}
              </button>
            ) : (
              // Sem login, nem valida o formulário: vai direto entrar (o carrinho fica salvo).
              <Link className="btn block" to="/login" state={{ from: location }}>
                Entrar para enviar o pedido
              </Link>
            )}
          </form>
        </section>
      </div>
    </main>
  )
}
