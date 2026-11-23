import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import CatalogStatus from '../../components/CatalogStatus'
import DailyAndCombos from '../../components/DailyAndCombos'
import LocationButton from '../../components/LocationButton'
import ProductCard from '../../components/ProductCard'
import { useCatalog } from '../../context/CatalogContext'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

// Imagem de capa de cada departamento na grade "Compre por departamento".
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

// Cada departamento tem a sua cor de fundo.
const TILE_TINT = {
  mercearia: '#ffe2a6',
  frioselaticinios: '#cfeaff',
  bebidas: '#ffd2c2',
  cervejas: '#ffe27a',
  acougue: '#ffc4c4',
  hortifruti: '#c9efbd',
  padaria: '#f8d9ae',
  congelados: '#c4ecf0',
  docesesnacks: '#ffcfe0',
  limpeza: '#bfe0ff',
  higiene: '#d3f0e3',
  pet: '#ffdcb5',
}

// As três portas da faixa de baixo: cada uma com as fotos do que ela mostra.
const BAND = [
  { to: '/clube', title: 'Clube VIP', pics: ['yopro.png', 'creme-leite.png'], text: 'Desconto nos produtos e frete grátis para quem é do clube.', cta: 'Conhecer o clube' },
  { to: '/receitas', title: 'Receitas', pics: ['aveia.png', 'toscana.png', 'batata-smiles.png'], text: 'Escolha o prato e compare o preço das lojas do bairro para montar o carrinho mais barato.', cta: 'Ver as receitas' },
  { to: '/acompanhar', title: 'Acompanhar pedido', pics: ['heineken.png', 'ariel.png'], text: 'Veja o status da entrega em tempo real, sem recarregar a página.', cta: 'Acompanhar meu pedido' },
]

// Três fotos de departamentos sob a frase.
const STMT_PICS = ['415bcb3f09.png', 'aveia.png', '7b0c1a45d7.png']

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function Home() {
  useDocumentTitle('VizinhoHub: os melhores preços do seu bairro e das regiões próximas')
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
  // A vitrine do hero mostra o que está em oferta; sem oferta, os mais vendidos.
  const featured = (homeOfertas.length >= 5 ? homeOfertas : bestSellers).filter((p) => p.img).slice(0, 4)
  const [lead, ...rest] = featured
  // Doze departamentos fecham a grade; os que têm capa cadastrada vêm primeiro, o resto está no catálogo.
  const shownDepartments = [
    ...productsByDepartment.filter((d) => TILE_IMG[d.slug]),
    ...productsByDepartment.filter((d) => !TILE_IMG[d.slug]),
  ].slice(0, 12)
  // Doze produtos fecham a grade de 4 colunas; faltando, completa com o resto do catálogo.
  const grid = [...bestSellers, ...products]
    .filter((p, i, all) => !featured.includes(p) && all.indexOf(p) === i)
    .slice(0, 12)

  // O momento da frase (public/assets/moments) liga depois que o catálogo desenhou a seção.
  useEffect(() => {
    // import() montado em runtime: o Vite não pode reescrever um arquivo de public/
    const load = new Function('url', 'return import(url)')
    load('/assets/moments/moments.js').then((m) => m.mountAll(document)).catch(() => {})
  }, [])

  return (
    <main className="home">
      <section className="hero-shop" data-enter aria-labelledby="hero-title">
        <div className="wrap">
          <div className="hero-text hero-shop__grid">
            <div className="hero-shop__text">
              <h1 id="hero-title">Os melhores preços do seu bairro e das regiões próximas</h1>
              <p className="hero-shop__lead">
                Procure o que você precisa, veja onde está mais barato perto de você e economize na compra do mês ou só no que faltou.
              </p>
              <div className="btn-row">
                <Link className="btn btn--primary" to="/produtos">Ver todos os produtos</Link>
                {ofertas.length > 0 ? (
                  <Link className="hero-shop__more" to="/ofertas">Ver as ofertas</Link>
                ) : (
                  <Link className="hero-shop__more" to="/clube">Conhecer o Clube VIP</Link>
                )}
              </div>
              <dl className="hero-shop__facts">
                <div>
                  <dt>No catálogo</dt>
                  <dd>{plural(products.length, 'produto', 'produtos')}</dd>
                </div>
                <div>
                  <dt>Departamentos</dt>
                  <dd>{departments.length}</dd>
                </div>
                {maxDiscount > 0 && (
                  <div>
                    <dt>Ofertas</dt>
                    <dd>até {maxDiscount}%</dd>
                  </div>
                )}
              </dl>
              <div className="hero-shop__meta"><LocationButton prefix="Entrega para " /></div>
            </div>

            {lead && (
              <div className="hero-shop__visual">
                <div className="hero-shop__wall">
                  <Link className="wall-tile wall-tile--lead" to={`/produto/${lead.id}`}>
                    <img src={imgSrc(lead)} alt={lead.name} width="400" height="400" />
                    <span className="wall-tile__info">
                      <strong>{lead.name}</strong>
                      <span>{formatBRL(lead.price)}</span>
                    </span>
                  </Link>
                  {rest.map((p) => (
                    <Link key={p.id} className="wall-tile" to={`/produto/${p.id}`} aria-label={`${p.name}, ${formatBRL(p.price)}`}>
                      <img src={imgSrc(p)} alt="" width="400" height="400" />
                      <span className="wall-tile__price">{formatBRL(p.price)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="block" data-h="1" aria-labelledby="depts-title">
        <div className="wrap">
          <div className="block__head">
            <h2 id="depts-title">Compre por departamento</h2>
            <Link className="btn btn--secondary" to="/produtos">Ver o catálogo</Link>
          </div>
          <div className="tiles">
            {shownDepartments.map((d) => (
              <Link key={d.slug} className="tile" to={`/produtos#${d.slug}`} style={{ "--tint": TILE_TINT[d.slug] }}>
                <span className="tile__img">
                  <img
                    src={TILE_IMG[d.slug] ? `/img/${TILE_IMG[d.slug]}` : imgSrc(d.products[0] ?? {})}
                    alt=""
                    width="400"
                    height="400"
                  />
                </span>
                <strong>{d.nome}</strong>
                <span className="tile__count">{plural(d.products.length, 'produto', 'produtos')}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {homeOfertas.length > 0 && (
        <section className="block block--alt" data-h="1" aria-labelledby="deals-title">
          <div className="wrap">
            <div className="block__head">
              <h2 id="deals-title">Ofertas da semana</h2>
              <Link className="btn btn--secondary" to="/ofertas">Ver todas as ofertas</Link>
            </div>
            <div className="product-grid">
              {homeOfertas.slice(0, 4).map((p, i) => <ProductCard key={p.id} product={p} index={i} eager />)}
            </div>
          </div>
        </section>
      )}

      <DailyAndCombos />

      <section className="block" data-h="1" data-moment="word-highlight" aria-label="Por que o VizinhoHub">
        <div className="wrap">
          <p className="stmt__label">Por que o VizinhoHub</p>
          <p className="mo-wh__text">
            Do açougue ao hortifruti, o VizinhoHub reúne os preços do seu bairro e das regiões próximas para você achar o melhor negócio <strong>sem rodar de mercado em mercado</strong>.
          </p>
          <div className="stmt__pics" aria-hidden="true">
            {STMT_PICS.map((f) => (
              <span key={f} className="stmt__pic"><img src={`/img/${f}`} alt="" width="400" height="400" /></span>
            ))}
          </div>
        </div>
      </section>

      <section className="block" data-h="2" aria-labelledby="best-title">
        <div className="wrap">
          <div className="block__head">
            <h2 id="best-title">Produtos mais vendidos</h2>
            <Link className="btn btn--secondary" to="/produtos">Ver mais produtos</Link>
          </div>
          <div className="product-grid product-grid--long">
            {grid.map((p, i) => <ProductCard key={p.id} product={p} index={i} eager />)}
          </div>
        </div>
      </section>

      <section className="band" data-h="1" aria-labelledby="club-title">
        <div className="wrap">
          <h2 id="club-title">Compre com mais folga no orçamento</h2>
          <div className="band__cols">
            {BAND.map((c) => (
              <div key={c.to} className="band__col">
                <div className="band__pics" aria-hidden="true">
                  {c.pics.map((f) => <img key={f} src={`/img/${f}`} alt="" width="400" height="400" />)}
                </div>
                <p className="band__title">{c.title}</p>
                <p>{c.text}</p>
                <Link className="btn btn--secondary" to={c.to}>{c.cta}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

export default Home
