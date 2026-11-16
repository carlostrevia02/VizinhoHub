import { useCallback, useEffect, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { WEEKDAYS, createSlot, formatDateTime, isoDay, listScheduledOrders, listSlots, removeSlot, setLeadTime, updateSlot } from '../../lib/caderneta'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/caderneta.css'

const EMPTY = { weekday: '1', startsAt: '09:00', endsAt: '12:00', capacity: '5' }

// Encomendas: faixas de retirada com capacidade, produtos sob encomenda e a agenda dos próximos dias.
export default function Agenda() {
  useDocumentTitle('Agenda e encomendas — VizinhoHub Manager')
  const { notify, products, reloadProducts } = useAdmin()
  const [slots, setSlots] = useState(null)
  const [orders, setOrders] = useState(null)
  const [days, setDays] = useState(7)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [lead, setLead] = useState({ productId: '', hours: '24' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const reload = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([listSlots(), listScheduledOrders(isoDay(0), isoDay(days))])
      setSlots(s)
      setOrders(o)
    } catch (err) {
      notify('Não foi possível carregar a agenda', errorMessage(err), 'error')
    }
  }, [days, notify])
  useEffect(() => {
    reload()
  }, [reload])

  async function addSlot(e) {
    e.preventDefault()
    setError('')
    try {
      await createSlot({ weekday: Number(form.weekday), startsAt: form.startsAt, endsAt: form.endsAt, capacity: Number(form.capacity) })
      notify('Faixa criada', '')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const act = (fn, title) => async () => {
    try {
      await fn()
      notify(title, '')
      await reload()
    } catch (err) {
      notify('Não foi possível concluir', errorMessage(err), 'error')
    }
  }

  async function saveLead(e) {
    e.preventDefault()
    if (!lead.productId) return setError('Escolha o produto.')
    setError('')
    try {
      await setLeadTime(lead.productId, Number(lead.hours))
      notify(Number(lead.hours) > 0 ? 'Produto marcado como encomenda' : 'Produto voltou para pronta entrega', '')
      reloadProducts?.()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const byDay = {}
  for (const o of orders ?? []) (byDay[o.scheduledFor.slice(0, 10)] ??= []).push(o)

  return (
    <>
      <h1 className="page-title">Agenda e encomendas</h1>
      <p className="sub">
        Crie faixas de retirada com número de vagas e marque quais produtos são sob encomenda (com antecedência mínima). O cliente
        agenda no checkout e a faixa fecha sozinha quando lota.
      </p>
      {error && <p className="deal-notice err" role="alert">{error}</p>}

      <div className="two">
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Faixas de retirada</h3>
          <form onSubmit={addSlot} className="cad-inline">
            <div className="field">
              <label htmlFor="sl-d">Dia</label>
              <select id="sl-d" value={form.weekday} onChange={set('weekday')}>{WEEKDAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="sl-a">Das</label><input id="sl-a" type="time" required value={form.startsAt} onChange={set('startsAt')} /></div>
            <div className="field"><label htmlFor="sl-b">Às</label><input id="sl-b" type="time" required value={form.endsAt} onChange={set('endsAt')} /></div>
            <div className="field"><label htmlFor="sl-c">Vagas</label><input id="sl-c" type="number" min="1" required value={form.capacity} onChange={set('capacity')} /></div>
            <button className="btn" type="submit">Criar faixa</button>
          </form>
          {slots === null ? <p className="muted">Carregando…</p> : slots.length === 0 ? <p className="muted">Nenhuma faixa ainda.</p> : (
            <div className="table-wrap" style={{ borderRadius: 'var(--radius)', marginTop: 12 }}>
              <table>
                <thead><tr><th>Dia</th><th>Horário</th><th>Vagas</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id}>
                      <td>{WEEKDAYS[s.weekday]}</td>
                      <td>{s.startsAt}–{s.endsAt}</td>
                      <td>{s.capacity}</td>
                      <td><span className={`tag ${s.active ? 'ok' : 'off'}`}>{s.active ? 'Ativa' : 'Pausada'}</span></td>
                      <td>
                        <div className="cad-actions">
                          <button className="btn ghost sm" type="button" onClick={act(() => updateSlot(s.id, { active: !s.active }), s.active ? 'Faixa pausada' : 'Faixa ativada')}>{s.active ? 'Pausar' : 'Ativar'}</button>
                          <button className="btn ghost sm" type="button" onClick={() => window.confirm('Remover esta faixa?') && act(() => removeSlot(s.id), 'Faixa removida')()}>Remover</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Produtos sob encomenda</h3>
          <form onSubmit={saveLead} className="cad-inline">
            <div className="field">
              <label htmlFor="ld-p">Produto</label>
              <select id="ld-p" value={lead.productId} onChange={(e) => setLead((l) => ({ ...l, productId: e.target.value }))}>
                <option value="">Escolha…</option>
                {(products ?? []).filter((p) => p.active && p.kind !== 'COMBO').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.leadTimeHours > 0 ? ` · encomenda ${p.leadTimeHours} h` : ''}</option>
                ))}
              </select>
            </div>
            <div className="field"><label htmlFor="ld-h">Antecedência (h; 0 = pronta entrega)</label><input id="ld-h" type="number" min="0" value={lead.hours} onChange={(e) => setLead((l) => ({ ...l, hours: e.target.value }))} /></div>
            <button className="btn" type="submit">Salvar</button>
          </form>
          <p className="muted">Carrinho com produto de encomenda só fecha com data e faixa escolhidas, respeitando a antecedência.</p>
        </section>
      </div>

      <div className="row" style={{ margin: '22px 0 10px' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Encomendas dos próximos dias</h2>
        <select aria-label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Hoje e amanhã</option>
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
        </select>
      </div>
      {orders === null ? <p className="muted">Carregando…</p> : orders.length === 0 ? <p className="muted">Nenhuma encomenda agendada neste período.</p> : (
        Object.entries(byDay).map(([day, list]) => (
          <div key={day} className="panel" style={{ marginBottom: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>{new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</h4>
            {list.map((o) => (
              <div className="line" key={o.id}>
                <span>
                  <strong>{formatDateTime(o.scheduledFor).slice(-5)}</strong> · {o.contact.name ?? o.customer?.name ?? 'Cliente'} · {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                </span>
                <span>
                  {formatBRL(o.totalPrice)}{o.depositAmount > 0 && <> · sinal {formatBRL(o.depositAmount)}</>} <span className="tag new">{o.status}</span>
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </>
  )
}
