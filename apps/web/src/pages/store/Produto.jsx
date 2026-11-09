import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ProductCard from '../../components/ProductCard'
import CatalogStatus from '../../components/CatalogStatus'
import { useCart } from '../../context/CartContext'
import { useCatalog } from '../../context/CatalogContext'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { track } from '../../lib/track'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import NotFound from '../NotFound'

const iconProps = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#1f7a4d', strokeWidth: 2.2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}

const REVIEWS = [
  { initial: 'M', name: 'Maria S.', stars: '★★★★★', text: 'Produto ótimo, chegou rápido e bem embalado.' },
  { initial: 'J', name: 'João L.', stars: '★★★★★', text: 'Preço bom para o bairro. Vou comprar de novo.' },
  { initial: 'A', name: 'Ana C.', stars: '★★★★☆', text: 'Tudo certo, só demorou um pouco na retirada.' },
  { initial: 'P', name: 'Pedro A.', stars: '★★★★★', text: 'Qualidade boa e atendimento simpático.' },
]

export default function Produto() {
  return (
    <CatalogStatus>
      <ProdutoLookup />
    </CatalogStatus>
  )
}

function ProdutoLookup() {
  const { id } = useParams()
  const { getProduct } = useCatalog()
  const product = getProduct(id)
  if (!product) return <NotFound />
  // key força o estado local (quantidade, aba) a reiniciar ao trocar de produto.
  return <ProdutoDetalhe key={product.id} product={product} />
}

function ProdutoDetalhe({ product: p }) {
  useDocumentTitle(`${p.name} — VizinhoHub`)
  const navigate = useNavigate()
  const { add } = useCart()
  const { related } = useCatalog()
  const [qty, setQty] = useState(1)
  const [tab, setTab] = useState('t1')
  useEffect(() => {
    track('STORE_VIEW', p.merchantId, undefined, { once: true })
    track('PRODUCT_VIEW', p.merchantId, p.id, { once: true })
  }, [p.merchantId, p.id])
  const deptName = p.deptName
  const soldOut = p.stock === 0
  const stockTag = soldOut ? 'off' : p.stock <= 5 ? 'low' : 'ok'
  const step = (delta) => (e) => {
    e.preventDefault()
    setQty((q) => Math.max(1, Math.min(q + delta, p.stock || 1)))
  }

  return (
    <main>
      <nav className="crumbs" aria-label="Você está em">
        <Link to="/">Início</Link> › <Link to={`/produtos#${p.dept}`}>{deptName}</Link> › <span>{p.name}</span>
      </nav>

      <section className="pdp">
        <div className="pdp-gallery sk sk-img">
          {p.discount > 0 && <span className="disc">-{p.discount}%</span>}
          <img src={imgSrc(p)} alt={p.name} width="400" height="400" />
        </div>
        <div className="pdp-info">
          <div>
            <span className={`tag ${stockTag}`}>{p.stockLabel}</span>{' '}
            <span className="meta">
              Departamento:{' '}
              <Link to={`/produtos#${p.dept}`} style={{ color: 'var(--green)', fontWeight: 700 }}>{deptName}</Link>
            </span>
          </div>
          <h1>{p.name}</h1>
          <div className="pdp-prices">
            {p.oldPrice && <s>{formatBRL(p.oldPrice)}</s>}
            <span className="price big">{formatBRL(p.price)}</span>
            {p.discount > 0 && <span className="tag low">-{p.discount}%</span>}
          </div>
          <ul className="perks">
            <li>
              <svg {...iconProps}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a4 4 0 018 0v2" /></svg>
              Retire na loja em até 30 minutos
            </li>
            <li>
              <svg {...iconProps}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
              Entrega no bairro sem taxa acima de R$ 60
            </li>
            <li>
              <svg {...iconProps}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
              Pagamento na retirada ou pelo WhatsApp
            </li>
          </ul>
          <div className="buy">
            <div className="qty-lg">
              <a href="#" aria-label="Diminuir" onClick={step(-1)}>−</a>
              <span>{qty}</span>
              <a href="#" aria-label="Aumentar" onClick={step(1)}>+</a>
            </div>
            <button
              className="btn orange"
              type="button"
              disabled={soldOut}
              onClick={() => {
                add(p.id, qty)
                navigate('/carrinho')
              }}
            >
              {soldOut ? 'Indisponível' : 'Adicionar ao carrinho'}
            </button>
            <Link className="btn ghost" to={`/produtos#${p.dept}`}>Continuar comprando</Link>
          </div>
          <p className="meta">Vendido e entregue por <b>{p.store.name}</b> · Código {p.code}</p>
        </div>
      </section>

      <section className="tabs">
        {[['t1'], ['t2'], ['t3']].map(([t]) => (
          <input key={t} type="radio" name="tab" id={t} checked={tab === t} onChange={() => setTab(t)} />
        ))}
        <div className="tab-labels">
          <label htmlFor="t1">Descrição</label>
          <label htmlFor="t2">Informações</label>
          <label htmlFor="t3">Avaliações ({REVIEWS.length})</label>
        </div>
        <div className="tab-panels">
          <div className="p1">
            <h3 style={{ marginTop: 0 }}>{p.name}</h3>
            <p>{p.description || 'Sem descrição cadastrada.'}</p>
            <p className="muted">As imagens são ilustrativas. Disponibilidade e preço podem variar conforme o estoque da loja.</p>
          </div>
          <div className="p2">
            <table className="spec">
              <tbody>
                <tr><th>Departamento</th><td>{deptName}</td></tr>
                <tr><th>Código</th><td>{p.code}</td></tr>
                <tr><th>Unidade de venda</th><td>{p.unit}</td></tr>
                <tr><th>Preço por un</th><td>{formatBRL(p.price)}</td></tr>
                <tr><th>Estoque disponível</th><td>{p.stock} un</td></tr>
                <tr><th>Loja</th><td>{[p.store.name, p.store.neighborhood].filter(Boolean).join(' — ')}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="p3">
            <p style={{ marginTop: 0 }}>
              <span className="stars" style={{ fontSize: '1.3rem' }}>★★★★★</span> <b>4,8</b> de 5 — {REVIEWS.length} avaliações
            </p>
            {REVIEWS.map((r) => (
              <div className="review" key={r.name}>
                <span className="avatar">{r.initial}</span>
                <div>
                  <strong>{r.name}</strong> <span className="stars">{r.stars}</span>
                  <br />
                  {r.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="section-head">
        <h2>Quem viu também comprou</h2>
        <Link to={`/produtos#${p.dept}`}>Ver todos</Link>
      </div>
      <div className="rail-track">
        {related(p).map((r, i) => <ProductCard key={r.id} product={r} index={i} />)}
      </div>
    </main>
  )
}
