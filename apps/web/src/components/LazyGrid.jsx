import { memo, useState } from 'react'
import ProductCard from './ProductCard'
import { hasObserver, useSentinel } from '../lib/useInView'

const BATCH = 24

// Card memoizado: evita re-render dos já montados quando entra um novo lote.
export const Card = memo(ProductCard)

// Grid com carregamento progressivo: 24 cards, +24 cada vez que o sentinela do fim aparece.
function LazyGrid({ products }) {
  const [shown, setShown] = useState(BATCH)
  const count = hasObserver ? Math.min(shown, products.length) : products.length
  const done = count >= products.length
  const sentinel = useSentinel(() => setShown((n) => n + BATCH), count)

  return (
    <div className="grid">
      {products.slice(0, count).map((p, i) => <Card key={p.id} product={p} index={i} />)}
      {!done && <div ref={sentinel} aria-hidden="true" style={{ gridColumn: '1 / -1', height: 1 }} />}
    </div>
  )
}

export default LazyGrid
