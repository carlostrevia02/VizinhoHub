import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { useAuth } from '../../context/AuthContext'
import { norm } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { formatWhen } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const LOYAL_ORDERS = 3 // a partir de quantos pedidos o cliente é "fiel"
const MONTH = 30 * 24 * 3600 * 1000

// Clientes = quem aparece nos pedidos da loja (a API não tem um cadastro à parte para o comerciante).
function buildCustomers(orders) {
  const map = new Map()
  for (const o of orders) {
    if (!o.customer) continue // venda de balcão
    const c = map.get(o.customer.id) ?? {
      id: o.customer.id, name: o.customer.name, phone: null, orders: 0, spent: 0, first: o.createdAt, last: o.createdAt,
    }
    if (o.status !== 'CANCELLED') {
      c.orders += 1
      c.spent += o.totalPrice
    }
    if (o.createdAt >= c.last) {
      c.last = o.createdAt
      c.phone = o.contact.phone ?? c.phone // telefone do pedido mais recente
    }
    if (o.createdAt < c.first) c.first = o.createdAt
    map.set(o.customer.id, c)
  }
  return [...map.values()].filter((c) => c.orders > 0).sort((a, b) => b.last.localeCompare(a.last))
}

const profile = (c) => (c.orders >= LOYAL_ORDERS ? { tone: 'ok', label: 'Fiel' } : c.orders === 1 ? { tone: 'new', label: 'Novo' } : { tone: 'prep', label: 'Recorrente' })

function Clientes() {
  useDocumentTitle('Clientes — VizinhoHub Manager')
  const { user } = useAuth()
  const { orders, ordersError, reloadOrders } = useAdmin()
  const [query, setQuery] = useState('')
  const customers = useMemo(() => buildCustomers(orders ?? []), [orders])

  const q = norm(query.trim())
  const shown = customers.filter((c) => !q || norm(c.name).includes(q) || (c.phone ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\0'))
  const newThisMonth = customers.filter((c) => Date.now() - new Date(c.first).getTime() < MONTH).length
  const loyal = customers.filter((c) => c.orders >= LOYAL_ORDERS).length

  return (
    <>
      <h1 className="page-title">Clientes</h1>
      <p className="sub">Moradores que já compraram em {user.store?.name ?? 'sua loja'}.</p>
      <div className="stats">
        <div className="stat sk sk-stat">
          <span className="muted">Clientes</span>
          <b>{orders ? customers.length : '–'}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 1 }}>
          <span className="muted">Novos no mês</span>
          <b>{orders ? newThisMonth : '–'}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 2 }}>
          <span className="muted">Clientes fiéis</span>
          <b>{orders ? loyal : '–'}</b>
        </div>
      </div>
      <div className="toolbar-row">
        <input type="search" placeholder="Buscar cliente por nome ou telefone" aria-label="Buscar cliente" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {ordersError ? (
        <p className="muted">
          Não foi possível carregar os clientes. <button className="btn sm" type="button" onClick={reloadOrders}>Tentar de novo</button>
        </p>
      ) : !orders ? (
        <p className="muted">Carregando clientes…</p>
      ) : (
        <div className="table-wrap sk sk-table" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th>Pedidos</th>
                <th>Total gasto</th>
                <th>Último pedido</th>
                <th>Perfil</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan="7" className="empty">Nenhum cliente encontrado.</td></tr>}
              {shown.map((c, i) => {
                const { tone, label } = profile(c)
                return (
                  <tr key={c.id} style={{ '--i': i }}>
                    <td><span className="avatar">{c.name.charAt(0).toUpperCase()}</span>{c.name}</td>
                    <td>{c.phone ?? '—'}</td>
                    <td>{c.orders}</td>
                    <td>{formatBRL(c.spent)}</td>
                    <td>{formatWhen(c.last)}</td>
                    <td><span className={`tag ${tone}`}>{label}</span></td>
                    <td><Link className="btn ghost sm" to={`/pedidos?q=${encodeURIComponent(c.name)}`}>Ver histórico</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="table-foot">
            <span className="muted">{shown.length} {shown.length === 1 ? 'cliente' : 'clientes'}</span>
          </div>
        </div>
      )}
    </>
  )
}

export default Clientes
