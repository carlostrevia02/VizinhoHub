import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import { useCatalog } from '../../context/CatalogContext'
import { api, ApiError } from '../../lib/api'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
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
  const nome = form.nome ?? displayName

  // A API aceita um pedido por loja: com itens de lojas diferentes, o cliente escolhe qual enviar agora.
  const merchants = [...new Map(lines.map((l) => [l.product.merchantId, l.product.store.name])).entries()]
  const merchantId = merchants.some(([id]) => id === chosen) ? chosen : merchants[0]?.[0]
  const storeName = merchants.find(([id]) => id === merchantId)?.[1]
  const orderLines = lines.filter((l) => l.product.merchantId === merchantId)
  const orderTotal = Math.round(orderLines.reduce((s, l) => s + l.qty * l.product.price * 100, 0)) / 100

  const sendOrder = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const order = await api.post('/orders', {
        items: orderLines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
        customerName: nome.trim() || undefined,
        phone: form.tel.trim() || undefined,
        deliveryMethod: form.ent,
        notes: form.obs.trim() || undefined,
      })
      setSent({
        nome: nome.trim(),
        loja: storeName,
        total: order.totalPrice,
        itens: order.items.reduce((n, i) => n + i.quantity, 0),
        id: order.id,
      })
      orderLines.forEach((l) => setQty(l.product.id, 0))
      reload() // o estoque mudou: a vitrine busca os números novos
    } catch (err) {
      console.error('Falha ao enviar pedido:', err)
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') reload()
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
                  <br />
                  <span className="muted">{formatBRL(p.price)} cada</span>
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
          <div className="line">
            <span className="total">Total{merchants.length > 1 ? ` · ${storeName}` : ''}</span>
            <span className="total">{formatBRL(orderTotal)}</span>
          </div>
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
            <div className="field">
              <label htmlFor="obs">Observações</label>
              <textarea id="obs" rows="2" placeholder="Ex.: sem sacola plástica" value={form.obs} onChange={set('obs')} />
            </div>
            {error && <p className="form-msg error" role="alert">{error}</p>}
            {user ? (
              <button className="btn block" type="submit" disabled={busy}>
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
