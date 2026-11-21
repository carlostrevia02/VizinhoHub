import { formatBRL } from '../lib/format'
import DealBranchLine from './DealBranchLine'

const UNIT = { un: 'un', kg: 'kg', g: 'g', l: 'L', ml: 'ml', pacote: 'pacote', bandeja: 'bandeja' }

// Oferta de supermercado do bairro. `onCoupon` só aparece para ofertas elegíveis (desconto ≥ 15%).
// `located`: o cliente tem localização; a filial mais próxima vem em `deal.nearestBranch` (pode chegar depois da lista).
function DealCard({ deal: d, index = 0, busy = false, onCoupon, located = false, pending = false }) {
  return (
    <article className="card deal sk sk-card" style={{ '--i': index % 6 }}>
      {d.discountPct > 0 && <span className="disc">-{d.discountPct}%</span>}
      <span className="deal-chain">
        {d.chain.name}
        {d.neighborhood && <> · {d.neighborhood}</>}
      </span>
      <h3>{d.productName}</h3>
      <div className="prices">
        {d.originalPrice ? <s>{formatBRL(d.originalPrice)}</s> : <s className="ghost">&nbsp;</s>}
        <span className="price">
          {formatBRL(d.discountPrice)}
          <small> / {UNIT[d.unit] ?? d.unit}</small>
        </span>
      </div>
      <div className="deal-tags">
        {d.isFlashDeal && <span className="tag low">Relâmpago</span>}
        {d.wholesaleMinQty > 1 && <span className="tag prep">A partir de {d.wholesaleMinQty} un.</span>}
        {d.deliveryEligible && <span className="tag ok">Entrega no bairro</span>}
      </div>
      <DealBranchLine branch={d.nearestBranch} located={located} pending={pending} />
      {d.couponEligible ? (
        <button className="btn" type="button" disabled={busy} onClick={() => onCoupon(d)}>
          {busy ? 'Gerando…' : 'Pegar cupom de retirada'}
        </button>
      ) : (
        <span className="muted">Oferta sem cupom — vale direto na loja.</span>
      )}
    </article>
  )
}

export default DealCard
