import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DealsStrip from '../../components/DealsStrip'
import ProductCard from '../../components/ProductCard'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import { useCatalog } from '../../context/CatalogContext'
import { useClientLocation } from '../../lib/clientLocation'
import { BAIRRO, getRadar } from '../../lib/flash'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { OfferCard } from './Radar'

const FLASH_PREVIEW = 6

// "Ofertas" sem escolher um tipo: junta as duas vitrines. Tá Quentinho (relâmpago perto do cliente) e Ofertas do
// bairro (supermercados) carregam cada uma por conta própria, então uma fora do ar não derruba a outra
// nem depende de o catálogo ter carregado.
function Ofertas() {
  useDocumentTitle('VizinhoHub Store — Ofertas')
  return (
    <main>
      <section className="page-hero red sk sk-img" style={{ '--i': 0 }}>
        <h1>Ofertas</h1>
        <p>Relâmpagos perto de você e as promoções dos supermercados do bairro, num lugar só.</p>
      </section>
      <TaQuentinho />
      <DealsStrip />
      <ProdutosComDesconto />
    </main>
  )
}

// Mesma fonte do /radar, sem pedir GPS: usa a localização que o site já tem ou o ponto de referência.
function TaQuentinho() {
  const { user } = useAuth()
  const { coords } = useClientLocation(user?.id)
  const { lines, addOffer, count } = useCart()
  const lat = coords?.lat ?? BAIRRO.lat
  const lng = coords?.lng ?? BAIRRO.lng
  const [offers, setOffers] = useState(null) // null = carregando
  const [error, setError] = useState(false)
  const [added, setAdded] = useState('')

  const load = useCallback(async () => {
    try {
      setOffers(await getRadar({ lat, lng, limit: FLASH_PREVIEW }))
      setError(false)
    } catch {
      setError(true)
    }
  }, [lat, lng])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000) // o saldo muda enquanto a tela está aberta
    return () => clearInterval(t)
  }, [load])

  const qtyInCart = (id) => lines.find((l) => l.id === `flash:${id}`)?.qty ?? 0
  const onAdd = (o) => {
    addOffer(o)
    setAdded(`${o.productName} foi para o carrinho.`)
  }

  return (
    <section aria-label="Tá Quentinho">
      <div className="section-head">
        <h2>Tá Quentinho</h2>
        <Link to="/radar">Ver todas</Link>
      </div>
      <p className="sub">Ofertas relâmpago perto de você: preço baixo, poucas unidades e pouco tempo.</p>
      {added && (
        <p className="deal-notice ok" role="status">
          {added} {count > 0 && <Link to="/carrinho">Ver carrinho ({count})</Link>}
        </p>
      )}
      {error ? (
        <p className="muted">
          Não foi possível carregar o Tá Quentinho agora. <button className="btn sm" type="button" onClick={load}>Tentar de novo</button>
        </p>
      ) : offers === null ? (
        <p className="muted">Procurando ofertas…</p>
      ) : offers.length === 0 ? (
        <p className="muted">
          Nenhuma oferta relâmpago ao seu alcance agora. <Link to="/radar">Abrir o Tá Quentinho</Link>
        </p>
      ) : (
        <div className="grid">
          {offers.map((o, i) => (
            <OfferCard key={o.id} offer={o} index={i} inCart={qtyInCart(o.id)} onAdd={onAdd} />
          ))}
        </div>
      )}
    </section>
  )
}

// O que a página mostrava antes (descontos automáticos do catálogo). Só aparece se o catálogo já carregou e há itens.
function ProdutosComDesconto() {
  const { ofertas, loading, error } = useCatalog()
  if (loading || error || !ofertas || ofertas.length === 0) return null
  return (
    <section aria-label="Produtos com desconto">
      <div className="section-head">
        <h2>Produtos com desconto</h2>
        <Link to="/produtos">Ver todos os produtos</Link>
      </div>
      <p className="sub">
        {ofertas.length} {ofertas.length === 1 ? 'produto' : 'produtos'} com desconto, do maior para o menor. Os descontos são aplicados
        automaticamente a produtos próximos do vencimento.
      </p>
      <div className="grid">
        {ofertas.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
      </div>
    </section>
  )
}

export default Ofertas
