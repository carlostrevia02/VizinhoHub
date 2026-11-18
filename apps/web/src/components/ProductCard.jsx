import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { imgSrc } from '../lib/catalog'
import { formatBRL } from '../lib/format'

function ProductCard({ product: p, index = 0 }) {
  const { add } = useCart()
  const soldOut = p.stock === 0
  const to = `/produto/${p.id}`

  return (
    <article className="card sk sk-card" style={{ '--i': index % 6 }}>
      {p.discount > 0 && <span className="disc">-{p.discount}%</span>}
      <Link className="thumb" to={to}>
        <img src={imgSrc(p)} alt={p.name} width="400" height="400" loading="lazy" />
      </Link>
      <h3>
        <Link to={to}>{p.name}</Link>
      </h3>
      <div className="prices">
        {p.oldPrice ? <s>{formatBRL(p.oldPrice)}</s> : <s className="ghost">&nbsp;</s>}
        <span className="price">{formatBRL(p.price)}</span>
      </div>
      {soldOut ? (
        <span className="tag off">Esgotado</span>
      ) : p.stock <= 5 ? (
        <span className="tag low">Restam {p.stock}</span>
      ) : (
        <span className="muted">{p.stock} em estoque</span>
      )}
      <button className="btn" type="button" disabled={soldOut} onClick={() => add(p.id)}>
        {soldOut ? 'Indisponível' : '+ Adicionar'}
      </button>
    </article>
  )
}

export default ProductCard
