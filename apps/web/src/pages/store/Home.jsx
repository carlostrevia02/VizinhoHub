import { Link } from 'react-router-dom'
import CatalogStatus from '../../components/CatalogStatus'
import ProductCard from '../../components/ProductCard'
import { useCatalog } from '../../context/CatalogContext'
import { imgSrc } from '../../lib/catalog'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

// Imagem de capa de cada departamento na grade "Navegue por departamento".
// Departamento sem capa cadastrada usa a foto do primeiro produto.
const TILE_IMG = {
  mercearia: 'aveia.png',
  frioselaticinios: 'creme-leite.png',
  bebidas: 'yopro.png',
  cervejas: 'heineken.png',
  acougue: 'toscana.png',
  hortifruti: '415bcb3f09.png',
  padaria: '0f57957ae9.png',
  congelados: 'batata-smiles.png',
  docesesnacks: 'b2c8745bf6.png',
  limpeza: 'ariel.png',
  higiene: '7b0c1a45d7.png',
  pet: '9f7127bbbf.png',
}

export default function Home() {
  useDocumentTitle('VizinhoHub Store — Início')
  return (
    <CatalogStatus>
      <HomeContent />
    </CatalogStatus>
  )
}

function HomeContent() {
  const { departments, productsByDepartment, ofertas, homeOfertas, homeMaisVendidos, products } = useCatalog()
  const maxDiscount = ofertas.reduce((m, p) => Math.max(m, p.discount), 0)
  const bestSellers = homeMaisVendidos.length > 0 ? homeMaisVendidos : products.slice(0, 12)

  return (
    <div className="shop">
      <div className="depts">
        <div className="chips" aria-label="Departamentos">
          <Link className="chip on" to="/produtos">Todos</Link>
          {departments.map((d) => (
            <Link key={d.slug} className="chip" to={`/produtos#${d.slug}`}>{d.nome}</Link>
          ))}
        </div>
      </div>

      <main>
        <section className="banners" aria-label="Promoções">
          <Link className="banner main sk sk-img" to="/ofertas" style={{ '--i': 0 }}>
            <h2>Ofertas da semana</h2>
            <p>
              {ofertas.length > 0
                ? `Até ${maxDiscount}% de desconto em ${ofertas.length} ${ofertas.length === 1 ? 'produto' : 'produtos'} do bairro.`
                : 'Produtos com desconto aparecem aqui assim que as lojas do bairro os liberarem.'}
            </p>
            <span className="btn orange">Ver ofertas</span>
            <img src="/img/ariel.png" alt="Ariel 3L" width="400" height="400" loading="lazy" />
          </Link>
          <Link className="banner yellow sk sk-img" to="/produtos#mercearia" style={{ '--i': 1 }}>
            <h2>Mercearia</h2>
            <p>O básico do dia a dia, direto do mercadinho.</p>
            <img src="/img/cafe-lor.png" alt="Café L'Or" width="400" height="400" loading="lazy" />
          </Link>
          <Link className="banner red sk sk-img" to="/produtos#frioselaticinios" style={{ '--i': 2 }}>
            <h2>Frios e laticínios</h2>
            <p>Queijos, iogurtes e muito mais.</p>
            <img src="/img/mussarela.png" alt="Mussarela" width="400" height="400" loading="lazy" />
          </Link>
        </section>

        {homeOfertas.length > 0 && (
          <>
            <div className="section-head">
              <h2>Ofertas imperdíveis</h2>
              <Link to="/ofertas">Ver todos</Link>
            </div>
            <div className="rail-track">
              {homeOfertas.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
            </div>
          </>
        )}

        <div className="section-head">
          <h2>Navegue por departamento</h2>
          <Link to="/produtos">Ver todos</Link>
        </div>
        <div className="tiles">
          {productsByDepartment.map((d, i) => (
            <Link key={d.slug} className="tile" to={`/produtos#${d.slug}`} style={{ '--i': i }}>
              <span className="tile-img">
                <img
                  src={TILE_IMG[d.slug] ? `/img/${TILE_IMG[d.slug]}` : imgSrc(d.products[0] ?? {})}
                  alt=""
                  width="400"
                  height="400"
                  loading="lazy"
                />
              </span>
              <strong>{d.nome}</strong>
              <small>{d.products.length} {d.products.length === 1 ? 'produto' : 'produtos'}</small>
            </Link>
          ))}
        </div>

        <div className="section-head">
          <h2>Mais vendidos</h2>
          <Link to="/produtos">Ver todos</Link>
        </div>
        <div className="rail-track">
          {bestSellers.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      </main>
    </div>
  )
}
