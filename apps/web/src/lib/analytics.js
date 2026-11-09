// Números do painel calculados no navegador a partir dos pedidos que a API devolve (até 200 mais recentes).
// Pedidos cancelados não contam como venda.

export const sales = (orders) => orders.filter((o) => o.status !== 'CANCELLED')
export const sum = (orders) => Math.round(orders.reduce((s, o) => s + o.totalPrice * 100, 0)) / 100

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Faturamento dos últimos `n` dias (o último é hoje). */
export function lastDays(orders, n = 7) {
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (n - 1 - i))
    return { key: dayKey(d), label: WEEKDAYS[d.getDay()], total: 0, orders: 0 }
  })
  const byKey = new Map(days.map((d) => [d.key, d]))
  for (const o of sales(orders)) {
    const day = byKey.get(dayKey(new Date(o.createdAt)))
    if (day) {
      day.total += o.totalPrice
      day.orders += 1
    }
  }
  return days.map((d) => ({ ...d, total: Math.round(d.total * 100) / 100 }))
}

/** Produtos mais vendidos (por unidades). */
export function topProducts(orders, limit = 5) {
  const map = new Map()
  for (const o of sales(orders)) {
    for (const i of o.items) {
      const cur = map.get(i.productId) ?? { productId: i.productId, name: i.name, qty: 0, revenue: 0 }
      cur.qty += i.quantity
      cur.revenue += i.quantity * i.unitPrice
      map.set(i.productId, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, limit)
}

/** Faturamento por departamento (os `keep` maiores + "Outros"), já em % do total. */
export function byDepartment(orders, products, keep = 4) {
  const deptOf = new Map((products ?? []).map((p) => [p.id, p.category.name]))
  const totals = new Map()
  for (const o of sales(orders)) {
    for (const i of o.items) {
      const dept = deptOf.get(i.productId) ?? 'Outros'
      totals.set(dept, (totals.get(dept) ?? 0) + i.quantity * i.unitPrice)
    }
  }
  const all = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const total = all.reduce((s, [, v]) => s + v, 0)
  if (total === 0) return []
  const head = all.slice(0, keep)
  const rest = all.slice(keep).reduce((s, [, v]) => s + v, 0)
  const rows = rest > 0 ? [...head, ['Outros', rest]] : head
  return rows.map(([name, value]) => ({ name, value, pct: Math.round((value / total) * 100) }))
}

export const DONUT_COLORS = ['#1f7a4d', '#f59e0b', '#3b82f6', '#e11d48', '#94a3b8']

/** Variáveis CSS do gráfico de rosca (.donut usa --cN e as porcentagens acumuladas --aN). */
export function donutStyle(rows) {
  const style = {}
  let acc = 0
  rows.forEach((r, i) => {
    style[`--c${i + 1}`] = DONUT_COLORS[i]
    acc += r.value
    if (i < rows.length - 1) style[`--a${i + 1}`] = `${Math.round((acc / rows.reduce((s, x) => s + x.value, 0)) * 100)}%`
  })
  return style
}
