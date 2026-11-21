import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { getStoreSettings, saveStoreSettings } from '../lib/caderneta'

const PERIODS = [
  ['weekdays', 'Segunda a sexta'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo e feriados'],
]
const PAYMENTS = [
  ['pix', 'Pix'],
  ['card', 'Cartão'],
  ['cash', 'Dinheiro'],
]

// API (null = fechado) <-> formulário ({ closed, open, close }).
const toForm = (s) => ({
  phone: s.phone ?? '',
  address: s.address ?? '',
  hours: Object.fromEntries(PERIODS.map(([k]) => [k, s.hours[k] ? { closed: false, ...s.hours[k] } : { closed: true, open: '08:00', close: '18:00' }])),
  deliveryEnabled: s.delivery.deliveryEnabled,
  pickupEnabled: s.delivery.pickupEnabled,
  minOrder: String(s.delivery.minOrder).replace('.', ','),
  payments: { ...s.payments },
})

// Atendimento da loja (Configurações): horário, entrega, pagamentos, telefone e endereço.
// Tudo vai para PUT /stores/me/settings e aparece na página pública da loja e no checkout.
function StoreSettingsPanel() {
  const [form, setForm] = useState(null) // null = carregando
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        setForm(toForm(await getStoreSettings()))
      } catch {
        setMsg({ text: 'Não foi possível carregar os dados de atendimento.', error: true })
      }
    }
    load()
  }, [])

  const setPeriod = (k, patch) => setForm((f) => ({ ...f, hours: { ...f.hours, [k]: { ...f.hours[k], ...patch } } }))

  const save = async (e) => {
    e.preventDefault()
    const fail = (text) => setMsg({ text, error: true })
    const minOrder = Number(String(form.minOrder).trim().replace(',', '.'))
    const phone = form.phone.trim()
    const address = form.address.trim()
    if (phone && phone.length < 8) return fail('Telefone: informe com DDD (mínimo 8 caracteres).')
    if (address && address.length < 3) return fail('Endereço: informe o endereço completo.')
    for (const [k, label] of PERIODS) {
      const p = form.hours[k]
      if (!p.closed && (!p.open || !p.close || p.close <= p.open)) return fail(`Horário (${label}): o fechamento precisa ser depois da abertura.`)
    }
    if (!form.deliveryEnabled && !form.pickupEnabled) return fail('Ative ao menos uma forma de receber: entrega ou retirada.')
    if (!Object.values(form.payments).some(Boolean)) return fail('Ative ao menos uma forma de pagamento.')
    if (!Number.isFinite(minOrder) || minOrder < 0 || minOrder > 100000) return fail('Pedido mínimo: informe um valor de R$ 0,00 a R$ 100.000,00.')

    setBusy(true)
    setMsg(null)
    try {
      // Sem pixKey no corpo: a API mantém a chave atual (ela é editada no painel de Chave Pix).
      const saved = await saveStoreSettings({
        phone: phone || null,
        address: address || null,
        hours: Object.fromEntries(PERIODS.map(([k]) => [k, form.hours[k].closed ? null : { open: form.hours[k].open, close: form.hours[k].close }])),
        delivery: { deliveryEnabled: form.deliveryEnabled, pickupEnabled: form.pickupEnabled, minOrder },
        payments: form.payments,
      })
      setForm(toForm(saved))
      setMsg({ text: 'Dados de atendimento salvos.' })
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h3>Atendimento e pagamento</h3>
      <p className="muted" style={{ marginTop: 0 }}>Aparece na página da loja e vale no checkout (pedido mínimo, entrega, retirada e formas de pagamento).</p>
      {!form ? (
        msg ? <p className="form-msg error" role="status">{msg.text}</p> : <p className="muted">Carregando…</p>
      ) : (
        <form onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor="at-tel">WhatsApp / telefone da loja</label>
            <input id="at-tel" inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="(85) 99999-0000" />
          </div>
          <div className="field">
            <label htmlFor="at-end">Endereço</label>
            <input id="at-end" maxLength={200} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Rua, número — bairro" />
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Horário de funcionamento</legend>
            {PERIODS.map(([k, label]) => {
              const p = form.hours[k]
              return (
                <div className="cad-inline" key={k} style={{ marginBottom: 8 }}>
                  <div className="field" style={{ flex: '1 1 150px' }}>
                    <label>
                      <input type="checkbox" checked={!p.closed} onChange={(e) => setPeriod(k, { closed: !e.target.checked })} style={{ width: 'auto' }} /> {label}
                    </label>
                  </div>
                  <div className="field"><input type="time" aria-label={`${label}: abre às`} disabled={p.closed} value={p.open} onChange={(e) => setPeriod(k, { open: e.target.value })} /></div>
                  <div className="field"><input type="time" aria-label={`${label}: fecha às`} disabled={p.closed} value={p.close} onChange={(e) => setPeriod(k, { close: e.target.value })} /></div>
                </div>
              )
            })}
            <span className="hint">Desmarque o dia para indicar que a loja fica fechada.</span>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Entrega</legend>
            <label style={{ display: 'block', marginBottom: 6 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.deliveryEnabled} onChange={(e) => setForm((f) => ({ ...f, deliveryEnabled: e.target.checked }))} /> Entrega no bairro
            </label>
            <label style={{ display: 'block', marginBottom: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.pickupEnabled} onChange={(e) => setForm((f) => ({ ...f, pickupEnabled: e.target.checked }))} /> Retirada na loja
            </label>
            <div className="field">
              <label htmlFor="at-min">Pedido mínimo para entrega (R$)</label>
              <input id="at-min" inputMode="decimal" value={form.minOrder} onChange={(e) => setForm((f) => ({ ...f, minOrder: e.target.value }))} placeholder="0,00" />
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Formas de pagamento</legend>
            {PAYMENTS.map(([k, label]) => (
              <label key={k} style={{ display: 'inline-block', marginRight: 16 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.payments[k]} onChange={(e) => setForm((f) => ({ ...f, payments: { ...f.payments, [k]: e.target.checked } }))} /> {label}
              </label>
            ))}
          </fieldset>
          {msg && <p className={`form-msg ${msg.error ? 'error' : 'ok'}`} role="status">{msg.text}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar atendimento'}</button>
        </form>
      )}
    </section>
  )
}

export default StoreSettingsPanel
