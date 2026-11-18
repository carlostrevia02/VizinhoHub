import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { norm } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { customerName, formatWhen, itemCount, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const PAGE_SIZE = 15
const TABS = [
  { key: 'all', label: 'Todos' },
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'IN_PREPARATION', label: 'Em preparação' },
  { key: 'READY', label: 'Prontos' },
  { key: 'COMPLETED', label: 'Entregues' },
  { key: 'CANCELLED', label: 'Cancelados' },
]

const isDelivery = (o) => /entrega/i.test(o.contact.deliveryMethod ?? '')
const kindOf = (o) => (o.channel === 'POS' ? 'Balcão' : isDelivery(o) ? 'Entrega' : 'Retirada')
const localDate = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function exportCsv(list) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [['Pedido', 'Cliente', 'Data', 'Itens', 'Total', 'Tipo', 'Status'].join(';')]
  for (const o of list) {
    lines.push(
      [orderCode(o.id), customerName(o), formatWhen(o.createdAt), itemCount(o), o.totalPrice.toFixed(2).replace('.', ','), kindOf(o), statusInfo(o.status).label]
        .map(cell)
        .join(';'),
    )
  }
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'pedidos.csv' })
  a.click()
  URL.revokeObjectURL(url)
}

function Pedidos() {
  useDocumentTitle('Pedidos — VizinhoHub Manager')
  const { orders, ordersError, reloadOrders } = useAdmin()
  const [tab, setTab] = useState('all')
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '') // vem de "Ver histórico" em Clientes
  const [kind, setKind] = useState('all') // all | pickup | delivery
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)

  const counts = useMemo(() => {
    const c = { all: orders?.length ?? 0 }
    for (const o of orders ?? []) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [orders])

  const filtered = useMemo(() => {
    const q = norm(query.trim().replace(/^#/, ''))
    return (orders ?? []).filter((o) => {
      if (tab !== 'all' && o.status !== tab) return false
      if (q && !norm(customerName(o)).includes(q) && !norm(orderCode(o.id)).includes(q)) return false
      if (kind === 'delivery' && !isDelivery(o)) return false
      if (kind === 'pickup' && isDelivery(o)) return false
      if (date && localDate(o.createdAt) !== date) return false
      return true
    })
  }, [orders, tab, query, kind, date])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const on = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }

  return (
    <>
      <h1 className="page-title">Histórico de pedidos</h1>
      <p className="sub">Consulte, filtre e acompanhe os pedidos da loja (os 200 mais recentes).</p>
      <div className="filters">
        {TABS.map((t) => (
          <a
            key={t.key}
            href="#"
            className={tab === t.key ? 'on' : undefined}
            onClick={(e) => {
              e.preventDefault()
              setTab(t.key)
              setPage(1)
            }}
          >
            {t.label} ({counts[t.key] ?? 0})
          </a>
        ))}
      </div>
      <div className="toolbar-row">
        <input type="search" placeholder="Buscar por cliente ou nº do pedido" aria-label="Buscar pedido" value={query} onChange={on(setQuery)} />
        <select aria-label="Entrega" value={kind} onChange={on(setKind)}>
          <option value="all">Retirada e entrega</option>
          <option value="pickup">Só retirada</option>
          <option value="delivery">Só entrega</option>
        </select>
        <input type="date" aria-label="Data" value={date} onChange={on(setDate)} />
        <button className="btn ghost" type="button" disabled={filtered.length === 0} onClick={() => exportCsv(filtered)}>
          Exportar CSV
        </button>
      </div>

      {ordersError ? (
        <p className="muted">
          Não foi possível carregar os pedidos. <button className="btn sm" type="button" onClick={reloadOrders}>Tentar de novo</button>
        </p>
      ) : !orders ? (
        <p className="muted">Carregando pedidos…</p>
      ) : (
        <div className="table-wrap sk sk-table" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Itens</th>
                <th>Total</th>
                <th>Tipo</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="8" className="empty">Nenhum pedido encontrado.</td></tr>}
              {rows.map((o, i) => {
                const { tone, label } = statusInfo(o.status)
                const to = `/pedido-detalhe?id=${o.id}`
                const name = customerName(o)
                return (
                  <tr key={o.id} style={{ '--i': i }}>
                    <td><Link style={{ color: 'var(--green)', fontWeight: 700 }} to={to}>#{orderCode(o.id)}</Link></td>
                    <td><span className="avatar">{name.charAt(0).toUpperCase()}</span>{name}</td>
                    <td>{formatWhen(o.createdAt)}</td>
                    <td>{itemCount(o)}</td>
                    <td>{formatBRL(o.totalPrice)}</td>
                    <td>{kindOf(o)}</td>
                    <td><span className={`tag ${tone}`}>{label}</span></td>
                    <td><Link className="btn ghost sm" to={to}>Detalhes</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="table-foot">
            <span className="muted">Mostrando {rows.length} de {filtered.length} {filtered.length === 1 ? 'pedido' : 'pedidos'}</span>
            {pages > 1 && (
              <span className="pager">
                <button className="btn ghost sm" type="button" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Página anterior">‹</button>
                <span className="muted" style={{ padding: '0 8px' }}>{current} / {pages}</span>
                <button className="btn ghost sm" type="button" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Próxima página">›</button>
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default Pedidos
