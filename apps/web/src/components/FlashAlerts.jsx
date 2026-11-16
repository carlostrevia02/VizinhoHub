import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { createAlert, getPosition, listAlerts, removeAlert } from '../lib/flash'

const EMPTY = { label: 'Casa', radiusM: '1500', quiet: false, quietFrom: '22:00', quietTo: '07:00' }
const msg = (err) => (err instanceof ApiError ? err.message : 'Algo deu errado. Tente novamente.')

// "Alertas perto de casa": o cliente escolhe um lugar e um raio e recebe push quando sai oferta relâmpago ali.
export default function FlashAlerts() {
  const [alerts, setAlerts] = useState(null) // null = carregando
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const reload = useCallback(async () => {
    try {
      setAlerts(await listAlerts())
    } catch (err) {
      setAlerts([])
      setNote({ text: msg(err), error: true })
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const radiusM = Number(form.radiusM)
    if (!form.label.trim()) return setNote({ text: 'Dê um nome ao lugar (ex.: Casa).', error: true })
    if (!Number.isInteger(radiusM) || radiusM < 200 || radiusM > 5000) return setNote({ text: 'O raio deve ser de 200 a 5.000 metros.', error: true })
    setBusy(true)
    setNote(null)
    try {
      const pos = await getPosition().catch(() => null)
      if (!pos) return setNote({ text: 'Não foi possível pegar a sua localização. Libere o acesso no navegador e tente de novo.', error: true })
      await createAlert({
        label: form.label.trim(),
        latitude: pos.lat,
        longitude: pos.lng,
        radiusM,
        ...(form.quiet && { quietFrom: form.quietFrom, quietTo: form.quietTo }),
      })
      setForm(EMPTY)
      setNote({ text: 'Alerta criado. Avisamos quando surgir oferta relâmpago por perto.' })
      await reload()
    } catch (err) {
      setNote({ text: msg(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  async function remove(a) {
    try {
      await removeAlert(a.id)
      setNote(null)
      await reload()
    } catch (err) {
      setNote({ text: msg(err), error: true })
    }
  }

  return (
    <div className="panel">
      <h3>Alertas perto de casa</h3>
      <p className="muted">Receba um aviso quando uma loja por perto lançar uma oferta relâmpago. Ative as notificações em “Meus dados”.</p>
      {alerts === null ? (
        <p className="muted">Carregando alertas…</p>
      ) : alerts.length === 0 ? (
        <p className="muted">Você ainda não tem alertas.</p>
      ) : (
        alerts.map((a) => (
          <div className="setting" key={a.id}>
            <div>
              <strong>{a.label}</strong>
              <small>
                Raio de {a.radiusM} m
                {a.quietFrom && a.quietTo ? ` · não perturbe das ${a.quietFrom} às ${a.quietTo}` : ''}
              </small>
            </div>
            <button className="btn ghost sm" type="button" onClick={() => remove(a)} aria-label={`Remover alerta ${a.label}`}>Remover</button>
          </div>
        ))
      )}

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <div className="two">
          <div className="field">
            <label htmlFor="al-label">Nome do lugar</label>
            <input id="al-label" maxLength={40} value={form.label} onChange={set('label')} />
          </div>
          <div className="field">
            <label htmlFor="al-radius">Raio (200 a 5.000 m)</label>
            <input id="al-radius" type="number" min="200" max="5000" step="100" value={form.radiusM} onChange={set('radiusM')} />
          </div>
        </div>
        <label className="deal-check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={form.quiet} onChange={set('quiet')} /> Não perturbe em um horário
        </label>
        {form.quiet && (
          <div className="two">
            <div className="field">
              <label htmlFor="al-from">Das</label>
              <input id="al-from" type="time" value={form.quietFrom} onChange={set('quietFrom')} required />
            </div>
            <div className="field">
              <label htmlFor="al-to">Até</label>
              <input id="al-to" type="time" value={form.quietTo} onChange={set('quietTo')} required />
            </div>
          </div>
        )}
        {note && <p className={`form-msg ${note.error ? 'error' : 'ok'}`} role="status">{note.text}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Criar alerta na minha localização atual'}</button>
      </form>
    </div>
  )
}
