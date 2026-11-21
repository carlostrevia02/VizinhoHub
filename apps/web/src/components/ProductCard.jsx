import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { imgSrc } from '../lib/catalog'
import { normalize } from '../lib/dealMatch'
import { useCountdown } from '../lib/flash'
import { useFlashOffer } from '../lib/flashOffers'
import { formatBRL } from '../lib/format'
import { useNeighborhoodDeal, useReserveOfferRow } from '../lib/neighborhoodDeals'
import DealBranchLine from './DealBranchLine'

const UNIT = { un: 'un', kg: 'kg', g: 'g', l: 'L', ml: 'ml', pacote: 'pacote', bandeja: 'bandeja' }

// Cartão do produto. Com `flash` ({ offer, text }), mostra a oferta relâmpago (Tá Quentinho) ali mesmo;
// com `nb` (useNeighborhoodDeal), a oferta de supermercado do bairro. Prioridade: Tá Quentinho > bairro > normal.
// Onde há provider de ofertas (aba Produtos) todo cartão reserva a faixa de oferta, para a grade ficar alinhada.
function BaseCard({ product: p, index = 0, eager = false, flash = null, nb = null }) {
  const { add, addOffer, lines } = useCart()
  const reserve = useReserveOfferRow()
  const to = `/produto/${p.id}`
  const offer = flash?.offer
  const inCart = offer ? (lines.find((l) => l.id === `flash:${offer.id}`)?.qty ?? 0) : 0
  const full = offer ? inCart >= Math.min(offer.maxPerCustomer, offer.qtyAvailable) : false

  return (
    <article className="card sk sk-card" style={{ '--i': index % 6 }}>
      {offer ? (
        <span className="disc">-{offer.discountPct}%</span>
      ) : nb ? (
        <span className="disc">-{nb.pct}%</span>
      ) : (
        p.discount > 0 && <span className="disc">-{p.discount}%</span>
      )}
      <Link className="thumb" to={to}>
        <img src={imgSrc(p)} alt={p.name} width="400" height="400" loading={eager ? 'eager' : 'lazy'} />
      </Link>
      <h3>
        <Link to={to}>{p.name}</Link>
      </h3>
      <div className="prices">
        {offer ? (
          <s>{formatBRL(offer.originalPrice)}</s>
        ) : nb ? (
          <s>{formatBRL(nb.refPrice)}</s>
        ) : p.oldPrice ? (
          <s>{formatBRL(p.oldPrice)}</s>
        ) : (
          <s className="ghost">&nbsp;</s>
        )}
        {nb && !offer ? (
          <span className="price">
            {formatBRL(nb.deal.discountPrice)}
            <small> / {UNIT[nb.deal.unit] ?? nb.deal.unit}</small>
          </span>
        ) : (
          <span className="price">{formatBRL(offer ? offer.offerPrice : p.price)}</span>
        )}
      </div>
      {(offer || nb || reserve) && (
        <div className={`offer-slot${offer || nb ? '' : ' is-empty'}`} aria-hidden={offer || nb ? undefined : 'true'}>
          {offer && (
            <div className="deal-tags">
              <span className={`tag ${offer.qtyAvailable <= 5 ? 'low' : 'ok'}`}>
                {offer.qtyAvailable === 1 ? 'Resta 1' : `Restam ${offer.qtyAvailable}`}
              </span>
              <span className="tag new">Acaba em {flash.text}</span>
            </div>
          )}
          {!offer && nb && (
            <>
              <div className="deal-tags">
                <span className="tag ok">Oferta no {nb.deal.chain.name}</span>
              </div>
              {/* a correspondência é aproximada: mostra o nome da oferta quando difere do produto */}
              {normalize(nb.deal.productName) !== normalize(p.name) && (
                <p className="offer-match" title={nb.deal.productName}>Oferta: {nb.deal.productName}</p>
              )}
              <DealBranchLine branch={nb.branch} located={nb.located} pending={nb.pending} compact />
            </>
          )}
        </div>
      )}
      {!offer && nb ? (
        // o cupom só é gerado em /ofertas-do-bairro
        <Link className="btn" to="/ofertas-do-bairro">
          {nb.deal.couponEligible ? 'Pegar cupom' : 'Ver oferta'}
        </Link>
      ) : (
        <button
          className="btn"
          type="button"
          disabled={full}
          onClick={() => (offer ? addOffer(offer) : add(p.id))}
        >
          {full ? 'Limite no carrinho' : 'Adicionar ao carrinho'}
        </button>
      )}
    </article>
  )
}

// Só os cartões com oferta têm contagem regressiva (um relógio por oferta, não por cartão).
// Encerrada, o cartão volta ao normal.
function FlashCard({ offer, nb, ...props }) {
  const { text, expired } = useCountdown(offer.endsAt)
  // Encerrada a relâmpago, vale a oferta do bairro (se houver): o cartão não volta ao normal à toa.
  return <BaseCard {...props} nb={expired ? nb : null} flash={expired ? null : { offer, text }} />
}

function ProductCard(props) {
  const offer = useFlashOffer(props.product.id)
  const nb = useNeighborhoodDeal(props.product.id)
  return offer ? <FlashCard {...props} offer={offer} nb={nb} /> : <BaseCard {...props} nb={nb} />
}

export default ProductCard
