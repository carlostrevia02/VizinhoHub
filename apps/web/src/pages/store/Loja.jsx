import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { api } from '../../lib/api'
import { getStoreDelivery } from '../../lib/delivery'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const PERIODS = [
  ['weekdays', 'Segunda a sexta'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo e feriados'],
]
const PAYMENT_LABELS = { pix: 'Pix', card: 'cartão', cash: 'dinheiro' }

const range = (p) => (p ? `${p.open} – ${p.close}` : 'Fechado')

// "Aberto agora até 21h" / "Fechado agora", pelo horário da loja (feriados não são considerados).
function openNow(hours) {
  const d = new Date()
  const p = hours[d.getDay() === 0 ? 'sunday' : d.getDay() === 6 ? 'saturday' : 'weekdays']
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return p && t >= p.open && t < p.close ? `Aberto agora até ${p.close.replace(/:00$/, 'h')}` : 'Fechado agora'
}

// Telefone brasileiro → link do WhatsApp (assume DDI 55 quando faltar).
function whatsappUrl(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`
}

function Loja() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const { products } = useCatalog()
  // Qual loja: ?id=…, a própria (lojista logado) ou a da vitrine (primeiro produto do catálogo).
  const merchantId = params.get('id') ?? (user?.role === 'MERCHANT' ? user.id : products[0]?.merchantId)
  const [store, setStore] = useState(null)
  const [delivery, setDelivery] = useState(null)
  const [failed, setFailed] = useState(false)
  useDocumentTitle(`${store?.name ?? 'Loja'} — VizinhoHub`)

  useEffect(() => {
    if (!merchantId) return
    let alive = true
    const load = async () => {
      try {
        const [s, d] = await Promise.all([api.get(`/stores/${merchantId}`), getStoreDelivery(merchantId).catch(() => null)])
        if (!alive) return
        setStore(s)
        setDelivery(d)
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [merchantId])

  if (failed) {
    return (
      <main>
        <h1 className="page-title">Loja não encontrada</h1>
        <p className="muted">Não foi possível carregar os dados da loja. <Link to="/produtos">Ver produtos</Link></p>
      </main>
    )
  }
  if (!store) return <main><p className="muted">Carregando loja…</p></main>

  const { settings } = store
  const wa = whatsappUrl(settings.phone)
  const payments = Object.entries(settings.payments).filter(([, on]) => on).map(([k]) => PAYMENT_LABELS[k])
  const receive = [
    settings.delivery.deliveryEnabled && 'entrega no bairro',
    settings.delivery.pickupEnabled && 'retirada na loja',
  ].filter(Boolean)

  return (
    <main>
      <section className="store-hero">
        <span className="logo-lg">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#0f3d2e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="20" r="1.6" />
            <circle cx="18" cy="20" r="1.6" />
            <path d="M2 3h3l2.5 12h11L21 7H6" />
          </svg>
        </span>
        <div>
          <h1>{store.name}</h1>
          <p style={{ margin: '0', opacity: '.9' }}>
            {[store.city, openNow(settings.hours), receive.length ? receive[0][0].toUpperCase() + receive.join(' e ').slice(1) : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      </section>
      <div className="two">
        <div className="panel">
          <h3>Horário de funcionamento</h3>
          <table className="spec">
            <tbody>
              {PERIODS.map(([k, label]) => (
                <tr key={k}>
                  <th>{label}</th>
                  <td>{range(settings.hours[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Contato e pagamento</h3>
          <dl className="kv">
            <dt>Endereço</dt>
            <dd>{settings.address ?? `${store.neighborhood}, ${store.city}`}</dd>
            {settings.phone && (
              <>
                <dt>WhatsApp</dt>
                <dd>{settings.phone}</dd>
              </>
            )}
            <dt>Entrega</dt>
            <dd>
              {settings.delivery.deliveryEnabled
                ? [
                    delivery?.deliveryFee != null && `taxa ${formatBRL(delivery.deliveryFee)}`,
                    settings.delivery.minOrder > 0 && `pedido mínimo ${formatBRL(settings.delivery.minOrder)}`,
                  ].filter(Boolean).join(' · ') || 'Entrega no bairro'
                : 'Sem entrega'}
              {settings.delivery.pickupEnabled ? ' · retirada na loja' : ''}
            </dd>
            <dt>Pagamento</dt>
            <dd>{payments.length ? payments.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Combine com a loja'}</dd>
          </dl>
          <p style={{ marginBottom: '0' }}>
            {wa && (
              <>
                <a className="btn orange" href={wa} target="_blank" rel="noopener noreferrer">Chamar no WhatsApp</a>
                {' '}
              </>
            )}
            <Link className="btn ghost" to="/produtos">Ver produtos</Link>
          </p>
        </div>
      </div>
    </main>
  )
}

export default Loja
