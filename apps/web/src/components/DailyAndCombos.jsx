import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalog } from '../context/CatalogContext'
import { getDailyMenu, listCombos } from '../lib/caderneta'
import '../styles/caderneta.css'
import ProductCard from './ProductCard'

// Vitrine: "Prato do dia" (só o que está ligado e com porções) e "Combos". Usa os mesmos cartões de produto do catálogo.
function DailyAndCombos() {
  const { products } = useCatalog()
  const [daily, setDaily] = useState([])
  const [combos, setCombos] = useState([])

  useEffect(() => {
    let alive = true
    getDailyMenu().then((d) => alive && setDaily(d)).catch(() => {})
    listCombos().then((c) => alive && setCombos(c)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const byId = new Map(products.map((p) => [p.id, p]))
  const dailyProducts = daily.filter((d) => d.qtyAvailable > 0).map((d) => byId.get(d.productId)).filter(Boolean)
  const comboProducts = combos.filter((c) => c.available > 0).map((c) => byId.get(c.id)).filter(Boolean)
  if (dailyProducts.length === 0 && comboProducts.length === 0) return null

  return (
    <>
      {dailyProducts.length > 0 && (
        <section className="daily-strip" aria-label="Prato do dia">
          <h2>🍽️ Prato do dia</h2>
          <p className="muted" style={{ margin: '0 0 8px' }}>Porções limitadas, feitas hoje. Quando acabam, saem da vitrine.</p>
          <div className="rail-track">
            {dailyProducts.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
        </section>
      )}
      {comboProducts.length > 0 && (
        <>
          <div className="section-head">
            <h2>Combos</h2>
            <Link to="/produtos">Ver todos</Link>
          </div>
          <div className="rail-track">
            {comboProducts.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
        </>
      )}
    </>
  )
}

export default DailyAndCombos
