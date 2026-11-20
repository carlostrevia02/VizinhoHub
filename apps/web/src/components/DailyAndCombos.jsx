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
    const fetchDaily = async () => {
      try {
        const d = await getDailyMenu()
        if (alive) setDaily(d)
      } catch {}
    }
    const fetchCombos = async () => {
      try {
        const c = await listCombos()
        if (alive) setCombos(c)
      } catch {}
    }
    fetchDaily()
    fetchCombos()
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
        <section className="block block--alt" data-h="1" aria-labelledby="daily-title">
          <div className="wrap">
            <div className="block__head">
              <h2 id="daily-title">Prato do dia</h2>
            </div>
            <p className="block__note">Porções limitadas, feitas hoje. Quando acabam, saem da vitrine.</p>
            <div className="product-grid">
              {dailyProducts.slice(0, 4).map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
            </div>
          </div>
        </section>
      )}
      {comboProducts.length > 0 && (
        <section className="block" data-h="1" aria-labelledby="combos-title">
          <div className="wrap">
            <div className="block__head">
              <h2 id="combos-title">Combos</h2>
              <Link className="link" to="/produtos">Ver todos os produtos</Link>
            </div>
            <div className="product-grid">
              {comboProducts.slice(0, 4).map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
            </div>
          </div>
        </section>
      )}
    </>
  )
}

export default DailyAndCombos
