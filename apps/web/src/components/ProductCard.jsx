import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { imgSrc } from '../lib/catalog'
import { useCountdown } from '../lib/flash'
import { useFlashOffer } from '../lib/flashOffers'
import { formatBRL } from '../lib/format'

// Cartão do produto. Com `flash` ({ offer, text }), mostra a oferta relâmpago (Tá Quentinho) ali mesmo.
function BaseCard({ product: p, index = 0, eager = false, flash = null }) {
  const { add, addOffer, lines } = useCart()
  const to = `/produto/${p.id}`
  const offer = flash?.offer
  const inCart = offer ? (lines.find((l) => l.id === `flash:${offer.id}`)?.qty ?? 0) : 0
  const full = offer ? inCart >= Math.min(offer.maxPerCustomer, offer.qtyAvailable) : false

  return (
    <article className="card sk sk-card" style={{ '--i': index % 6 }}>
      {offer ? <span className="disc">-{offer.discountPct}%</span> : p.discount > 0 && <span className="disc">-{p.discount}%</span>}
      <Link className="thumb" to={to}>
        <img src={imgSrc(p)} alt={p.name} width="400" height="400" loading={eager ? 'eager' : 'lazy'} />
      </Link>
      <h3>
        <Link to={to}>{p.name}</Link>
      </h3>
      <div className="prices">
        {offer ? <s>{formatBRL(offer.originalPrice)}</s> : p.oldPrice ? <s>{formatBRL(p.oldPrice)}</s> : <s className="ghost">&nbsp;</s>}
        <span className="price">{formatBRL(offer ? offer.offerPrice : p.price)}</span>
      </div>
      {offer && (
        <div className="deal-tags">
          <span className={`tag ${offer.qtyAvailable <= 5 ? 'low' : 'ok'}`}>
            {offer.qtyAvailable === 1 ? 'Resta 1' : `Restam ${offer.qtyAvailable}`}
          </span>
          <span className="tag new">Acaba em {flash.text}</span>
        </div>
      )}
      <button
        className="btn"
        type="button"
        disabled={full}
        onClick={() => (offer ? addOffer(offer) : add(p.id))}
      >
        {full ? 'Limite no carrinho' : 'Adicionar ao carrinho'}
      </button>
    </article>
  )
}

// Só os cartões com oferta têm contagem regressiva (um relógio por oferta, não por cartão).
// Encerrada, o cartão volta ao normal.
function FlashCard({ offer, ...props }) {
  const { text, expired } = useCountdown(offer.endsAt)
  return <BaseCard {...props} flash={expired ? null : { offer, text }} />
}

function ProductCard(props) {
  const offer = useFlashOffer(props.product.id)
  return offer ? <FlashCard {...props} offer={offer} /> : <BaseCard {...props} />
}

export default ProductCard
