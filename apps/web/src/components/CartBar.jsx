import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { formatBRL } from '../lib/format'

export default function CartBar() {
  const { count, total } = useCart()
  if (count === 0) return null
  return (
    <div className="cartbar">
      <span className="cart-info">
        <span className="cart-badge">{count}</span>
        <span>
          <strong>Meu carrinho</strong>
          <br />
          <small>{formatBRL(total)}</small>
        </span>
      </span>
      <Link className="btn orange" to="/carrinho">
        Finalizar pedido
      </Link>
    </div>
  )
}
