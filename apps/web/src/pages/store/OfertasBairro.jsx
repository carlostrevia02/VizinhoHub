import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DealCard from '../../components/DealCard'
import DealLocationBar from '../../components/DealLocationBar'
import { useAuth } from '../../context/AuthContext'
import { claimCoupon, confirmCoupon, listChains, listDeals, listMyCoupons } from '../../lib/deals'
import { useClientLocation } from '../../lib/clientLocation'
import { formatBRL } from '../../lib/format'
import { useDealBranches } from '../../lib/useDealBranches'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNearbyLocation } from '../../lib/useNearbyLocation'

const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const STATUS = { ACTIVE: ['ok', 'Ativo'], REDEEMED: ['prep', 'Compra confirmada'], EXPIRED: ['off', 'Vencido'] }

const CONFIRM_ERRORS = {
  COUPON_NOT_FOUND: 'Não encontramos este cupom. Atualizamos a lista para você.',
  COUPON_ALREADY_CONFIRMED: 'Você já confirmou a compra deste cupom.',
  COUPON_EXPIRED: 'Este cupom venceu e não pode mais ser confirmado.',
}

// Cupom da lista do cliente. O botão só existe enquanto o cupom está ativo e dentro da validade;
// pede um segundo toque ("Sim, já paguei") para evitar confirmação sem querer. O lucro do VizinhoHub nunca é exibido.
function CouponItem({ coupon: c, onConfirmed }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, text }
  const expired = c.status === 'EXPIRED' || (c.status === 'ACTIVE' && new Date(c.expiresAt) <= new Date())
  const status = expired ? 'EXPIRED' : c.status
  const saved = Math.max(0, (c.originalPrice - c.unitPrice) * c.minQty)

  async function confirm() {
    setBusy(true)
    setResult(null)
    try {
      await confirmCoupon(c.id)
      setAsking(false)
      await onConfirmed()
    } catch (err) {
      setAsking(false)
      setResult({ ok: false, text: CONFIRM_ERRORS[err.code] ?? err.message })
      // 404/409 mudam o estado real do cupom: recarrega a lista para refletir.
      if (err.status === 404 || err.status === 409) await onConfirmed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="card deal-coupon">
      <b className="deal-code">{c.code}</b>
      <span>{c.productName} — {formatBRL(c.unitPrice)}{c.minQty > 1 ? ` (a partir de ${c.minQty} un.)` : ''}</span>
      <span className="muted">{c.chain.name} · válido até {fmtDateTime(c.expiresAt)}</span>
      <span className={`tag ${STATUS[status][0]}`}>{STATUS[status][1]}</span>
      {status === 'REDEEMED' && (
        <>
          {c.redeemedAt && <span className="muted">Confirmada em {fmtDateTime(c.redeemedAt)}</span>}
          {saved > 0 && <b className="deal-saving">Você economizou {formatBRL(saved)}</b>}
        </>
      )}
      {status === 'ACTIVE' && !asking && (
        <button className="btn sm" type="button" disabled={busy} onClick={() => { setResult(null); setAsking(true) }}>
          Confirmei minha compra
        </button>
      )}
      {status === 'ACTIVE' && asking && (
        <div className="deal-confirm" role="group" aria-label={`Confirmar compra do cupom ${c.code}`}>
          <p className="muted">Toque só depois de pagar no caixa. Não dá para desfazer.</p>
          <div className="deal-confirm-actions">
            <button className="btn sm" type="button" disabled={busy} onClick={confirm}>
              {busy ? 'Confirmando…' : 'Sim, já paguei'}
            </button>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setAsking(false)}>
              Ainda não
            </button>
          </div>
        </div>
      )}
      <p className={`deal-coupon-msg ${result && !result.ok ? 'err' : ''}`} role="status" aria-live="polite">{result?.text}</p>
    </li>
  )
}

function OfertasBairro() {
  useDocumentTitle('VizinhoHub Store — Ofertas do bairro')
  const { user } = useAuth()
  // Bairro do local de entrega; sem local definido, lista as ofertas de todos os bairros.
  const { neighborhood } = useNearbyLocation(user?.id)
  const location = useClientLocation(user?.id)
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
    const fetchChains = async () => {
      try {
        const c = await listChains()
        setChains(c.filter((x) => x.dealCount > 0))
      } catch {}
    }
    fetchChains()
  }, [])

  useEffect(() => {
    const fetchDeals = async () => {
      try {
        const d = await listDeals({ neighborhood, search: search.trim(), chain, couponEligible: onlyCoupon || undefined, limit: 60 })
        setDeals(d)
        setError('')
      } catch {
        setError('Não foi possível carregar as ofertas agora. Tente novamente em instantes.')
      }
    }
    const t = setTimeout(() => {
      setDeals(null)
      fetchDeals()
    }, 250)
    return () => clearTimeout(t)
  }, [neighborhood, search, chain, onlyCoupon])

  // Filial mais próxima por oferta: 2ª requisição (mesmos filtros + lat/lng), sem atrasar nem refazer a lista.
  const { branches, pending } = useDealBranches({ neighborhood, search: search.trim(), chain, couponEligible: onlyCoupon || undefined, limit: 60 }, location.coords)

  const refreshCoupons = useCallback(() => {
    const fetchCoupons = async () => {
      try {
        setCoupons(await listMyCoupons())
      } catch {
        setCoupons([])
      }
    }
    if (!user) return setCoupons([])
    return fetchCoupons()
  }, [user])
  useEffect(() => {
    refreshCoupons()
  }, [refreshCoupons])

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
      <DealLocationBar location={location} />

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
          {deals.map((d, i) => (
            <DealCard key={d.id} deal={{ ...d, nearestBranch: branches[d.id] }} index={i} busy={busyId === d.id} onCoupon={onCoupon} located={Boolean(location.coords)} pending={pending} />
          ))}
        </div>
      )}

      {user && coupons.length > 0 && (
        <section className="dept-section" id="cupons">
          <div className="section-head">
            <h2>Meus cupons</h2>
          </div>
          <ul className="deal-coupons">
            {coupons.map((c) => <CouponItem key={c.id} coupon={c} onConfirmed={refreshCoupons} />)}
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
