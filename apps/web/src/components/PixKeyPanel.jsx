import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { getStoreSettings, saveStoreSettings } from '../lib/caderneta'

// Chave Pix do lojista (Configurações): usada no "Pix copia e cola" do lembrete da caderneta.
// O dinheiro vai direto para a conta do lojista; a plataforma só monta o texto.
function PixKeyPanel() {
  const [settings, setSettings] = useState(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const s = await getStoreSettings()
        setSettings(s)
        setKey(s.pixKey ?? '')
      } catch {
        setMsg({ text: 'Não foi possível carregar a chave Pix.', error: true })
      }
    }
    fetchSettings()
  }, [])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      // Relê antes de salvar: o painel "Atendimento" pode ter alterado horário/pagamento nesse meio-tempo.
      const fresh = await getStoreSettings()
      const saved = await saveStoreSettings({ ...fresh, pixKey: key.trim() || null })
      setSettings(saved)
      setKey(saved.pixKey ?? '')
      setMsg({ text: saved.pixKey ? 'Chave Pix salva.' : 'Chave Pix removida.' })
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Não foi possível salvar.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h3>Chave Pix (caderneta)</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Aparece no lembrete de cobrança como “Pix copia e cola”, já com o valor devido. O pagamento cai direto na sua conta: você dá baixa na caderneta
        depois. Pode ser CPF/CNPJ, e-mail, celular ou chave aleatória.
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="pix-key">Chave Pix</label>
          <input id="pix-key" maxLength={77} value={key} disabled={!settings} onChange={(e) => setKey(e.target.value)} placeholder="ex.: loja@email.com" />
        </div>
        {msg && <p className={`form-msg ${msg.error ? 'error' : 'ok'}`} role="status">{msg.text}</p>}
        <button className="btn" type="submit" disabled={busy || !settings}>{busy ? 'Salvando…' : 'Salvar chave Pix'}</button>
      </form>
    </section>
  )
}

export default PixKeyPanel
