import LazyGrid from './LazyGrid'
import { useInView } from '../lib/useInView'

// Altura estimada do placeholder (≈ linhas de 4 cards de ~380px) para a rolagem fazer sentido.
const estHeight = (n) => Math.ceil(Math.min(n, 24) / 4) * 380

// Departamento: cabeçalho sempre presente; o grid só monta quando a seção chega perto da viewport.
function DeptSection({ dept }) {
  const [ref, mounted] = useInView('2500px 0px')

  return (
    <section
      ref={ref}
      id={dept.slug}
      className="dept-section"
      style={mounted ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 600px' } : undefined}
    >
      <div className="section-head">
        <h2>{dept.nome} <span className="dcount">{dept.products.length}</span></h2>
        <a href="#topo">Voltar ao topo</a>
      </div>
      {mounted
        ? <LazyGrid products={dept.products} />
        : <div aria-hidden="true" style={{ minHeight: estHeight(dept.products.length) }} />}
    </section>
  )
}

export default DeptSection
