import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DealCard from '../../components/DealCard'
import { useAuth } from '../../context/AuthContext'
import { claimCoupon, listChains, listDeals, listMyCoupons } from '../../lib/deals'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const BAIRRO = 'Aldeota' // até existir seleção de endereço: o mesmo bairro exibido no topo da loja

const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const STATUS = { ACTIVE: ['ok', 'Ativo'], REDEEMED: ['prep', 'Usado'], EXPIRED: ['off', 'Vencido'] }

function OfertasBairro() {
  useDocumentTitle('VizinhoHub Store — Ofertas do bairro')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [chain, setChain] = useState('')
  const [onlyCoupon, setOnlyCoupon] = useState(false)
  const [chains, setChains] = useState([])
  const [deals, setDeals] = useState(null) // null = carregando
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [coupons, setCoupons] = useState([])
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    listChains().then((c) => setChains(c.filter((x) => x.dealCount > 0))).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      setDeals(null)
      listDeals({ neighborhood: BAIRRO, search: search.trim(), chain, couponEligible: onlyCoupon || undefined, limit: 60 })
        .then((d) => {
          setDeals(d)
          setError('')
        })
        .catch(() => setError('Não foi possível carregar as ofertas agora. Tente novamente em instantes.'))
    }, 250)
    return () => clearTimeout(t)
  }, [search, chain, onlyCoupon])

  const refreshCoupons = useCallback(() => {
    if (!user) return setCoupons([])
    listMyCoupons().then(setCoupons).catch(() => setCoupons([]))
  }, [user])
  useEffect(refreshCoupons, [refreshCoupons])

  async function onCoupon(deal) {
    if (!user) return navigate('/login', { state: { from: { pathname: '/ofertas-do-bairro' } } })
    setBusyId(deal.id)
    setNotice(null)
    try {
      const c = await claimCoupon(deal.id)
      setNotice({ ok: true, text: `Cupom ${c.code} gerado para ${c.productName}. Mostre o código no caixa do ${c.chain.name} até ${fmtDateTime(c.expiresAt)}.` })
      refreshCoupons()
    } catch (err) {
      setNotice({ ok: false, text: err.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main>
      <section className="page-hero red sk sk-img" style={{ '--i': 0 }}>
        <h1>Ofertas do bairro</h1>
        <p>Promoções dos supermercados perto de você, atualizadas a cada hora. Pegue o cupom e retire no caixa.</p>
      </section>

      <div className="deal-filters">
        <input type="search" placeholder="Buscar produto (ex.: leite)" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar oferta" />
        <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Supermercado">
          <option value="">Todos os supermercados</option>
          {chains.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name} ({c.dealCount})</option>
          ))}
        </select>
        <label className="deal-check">
          <input type="checkbox" checked={onlyCoupon} onChange={(e) => setOnlyCoupon(e.target.checked)} /> Só com cupom
        </label>
      </div>

      {notice && (
        <p className={`deal-notice ${notice.ok ? 'ok' : 'err'}`} role="status">{notice.text}</p>
      )}

      {error ? (
        <p className="sub">{error}</p>
      ) : deals === null ? (
        <p className="muted">Carregando ofertas…</p>
      ) : deals.length === 0 ? (
        <p className="sub">Nenhuma oferta encontrada por aqui agora. Volte daqui a pouco — buscamos novidades a cada hora.</p>
      ) : (
        <div className="grid">
          {deals.map((d, i) => <DealCard key={d.id} deal={d} index={i} busy={busyId === d.id} onCoupon={onCoupon} />)}
        </div>
      )}

      {user && coupons.length > 0 && (
        <section className="dept-section" id="cupons">
          <div className="section-head">
            <h2>Meus cupons</h2>
          </div>
          <ul className="deal-coupons">
            {coupons.map((c) => (
              <li key={c.id} className="card">
                <b className="deal-code">{c.code}</b>
                <span>{c.productName} — {formatBRL(c.unitPrice)}{c.minQty > 1 ? ` (a partir de ${c.minQty} un.)` : ''}</span>
                <span className="muted">{c.chain.name} · válido até {fmtDateTime(c.expiresAt)}</span>
                <span className={`tag ${STATUS[c.status][0]}`}>{STATUS[c.status][1]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted" style={{ marginTop: 24 }}>
        Preços e disponibilidade são informados pelos supermercados e podem mudar. <Link to="/ofertas">Ver ofertas da loja</Link>
      </p>
    </main>
  )
}

export default OfertasBairro
