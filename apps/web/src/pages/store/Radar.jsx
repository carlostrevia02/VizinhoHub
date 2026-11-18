import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { ApiError } from '../../lib/api'
import { imgSrc } from '../../lib/catalog'
import { BAIRRO, formatDistance, getPosition, getRadar, useCountdown } from '../../lib/flash'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

function OfferCard({ offer: o, index, inCart, onAdd }) {
  const { text, expired } = useCountdown(o.endsAt)
  const limit = Math.min(o.maxPerCustomer, o.qtyAvailable)
  const full = inCart >= limit
  const low = o.qtyAvailable <= 5
  return (
    <article className="card sk sk-card" style={{ '--i': index % 6 }}>
      <span className="disc">-{o.discountPct}%</span>
      <span className="thumb">
        <img src={imgSrc({ img: o.image })} alt={o.productName} width="400" height="400" loading="lazy" />
      </span>
      <h3>{o.productName}</h3>
      <span className="muted">
        {o.storeName}
        {o.neighborhood ? ` · ${o.neighborhood}` : ''} · a {formatDistance(o.distanceM ?? 0)}
      </span>
      <div className="prices">
        <s>{formatBRL(o.originalPrice)}</s>
        <span className="price">{formatBRL(o.offerPrice)}</span>
      </div>
      <div className="deal-tags">
        <span className={`tag ${low ? 'low' : 'ok'}`}>{o.qtyAvailable === 1 ? 'Resta 1' : `Restam ${o.qtyAvailable}`}</span>
        <span className="tag new">{expired ? 'Encerrada' : `Acaba em ${text}`}</span>
      </div>
      <span className="muted">Máx. {o.maxPerCustomer} por cliente</span>
      <button className="btn" type="button" disabled={expired || full} onClick={() => onAdd(o)}>
        {expired ? 'Encerrada' : full ? 'Limite no carrinho' : '+ Adicionar'}
      </button>
    </article>
  )
}

function Radar() {
  useDocumentTitle('VizinhoHub Store — Tá Quentinho')
  const { lines, addOffer, count } = useCart()
  const [place, setPlace] = useState(null) // { lat, lng, fallback }
  const [offers, setOffers] = useState(null) // null = carregando
  const [error, setError] = useState('')
  const [added, setAdded] = useState('')

  const locate = useCallback(() => {
    setOffers(null)
    setError('')
    getPosition()
      .then((p) => setPlace({ ...p, fallback: false }))
      .catch(() => setPlace({ lat: BAIRRO.lat, lng: BAIRRO.lng, fallback: true }))
  }, [])
  useEffect(locate, [locate])

  const load = useCallback(() => {
    if (!place) return
    getRadar({ lat: place.lat, lng: place.lng })
      .then((r) => {
        setOffers(r)
        setError('')
      })
      .catch((err) => setError(err instanceof ApiError && err.code === 'NETWORK' ? err.message : 'Não foi possível carregar as ofertas agora.'))
  }, [place])
  useEffect(load, [load])
  // O saldo muda enquanto a tela está aberta: atualiza a cada 30 s.
  useEffect(() => {
    if (!place) return undefined
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [place, load])

  const qtyInCart = (id) => lines.find((l) => l.id === `flash:${id}`)?.qty ?? 0
  const onAdd = (o) => {
    addOffer(o)
    setAdded(`${o.productName} foi para o carrinho.`)
  }

  return (
    <main>
      <h1 className="page-title">Tá Quentinho</h1>
      <p className="sub">Ofertas relâmpago perto de você: preço baixo, poucas unidades e pouco tempo.</p>

      {place?.fallback && (
        <p className="deal-notice err" role="status">
          Não conseguimos pegar a sua localização, então estamos mostrando as ofertas do bairro {BAIRRO.nome}.{' '}
          <button className="btn sm" type="button" onClick={locate}>Tentar de novo</button>
        </p>
      )}
      {added && (
        <p className="deal-notice ok" role="status">
          {added} {count > 0 && <Link to="/carrinho">Ver carrinho ({count})</Link>}
        </p>
      )}

      {error ? (
        <p className="muted">
          {error} <button className="btn sm" type="button" onClick={load}>Tentar de novo</button>
        </p>
      ) : offers === null ? (
        <p className="muted">{place ? 'Procurando ofertas…' : 'Descobrindo onde você está…'}</p>
      ) : offers.length === 0 ? (
        <p className="muted">
          Nenhuma oferta relâmpago ao seu alcance agora. Crie um alerta em <Link to="/conta">Minha conta</Link> para ser avisado.
        </p>
      ) : (
        <div className="grid">
          {offers.map((o, i) => (
            <OfferCard key={o.id} offer={o} index={i} inCart={qtyInCart(o.id)} onAdd={onAdd} />
          ))}
        </div>
      )}
    </main>
  )
}

export default Radar
