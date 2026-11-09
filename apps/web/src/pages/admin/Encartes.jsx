import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { FLYER_ACCEPT, FLYER_LIMITS, listChains, listFlyers, uploadFlyer } from '../../lib/deals'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STATUS = {
  PROCESSING: ['prep', 'Lendo…'],
  SUCCESS: ['ok', 'Publicado'],
  FAILED: ['low', 'Falhou'],
}
const POLL_MS = 3000
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
const when = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Valida no navegador o que a API também valida (tipo e tamanho), para o erro aparecer antes do envio.
function fileProblem(file) {
  if (!file) return 'Escolha o arquivo do encarte.'
  const pdf = file.type === 'application/pdf'
  if (!pdf && !FLYER_ACCEPT.split(',').includes(file.type)) return 'Envie o encarte como PDF, JPEG, PNG ou WebP.'
  const max = pdf ? FLYER_LIMITS.pdf : FLYER_LIMITS.image
  if (file.size > max) return `O arquivo tem ${mb(file.size)}; o máximo é ${mb(max)} para ${pdf ? 'PDF' : 'imagem'}.`
  return ''
}

// Gerentes (e parceiros autorizados) de uma rede enviam o encarte; o Claude lê e publica as ofertas no bairro.
export default function Encartes() {
  useDocumentTitle('Encartes dos mercados — VizinhoHub Manager')
  const { notify } = useAdmin()
  const [chains, setChains] = useState([])
  const [uploads, setUploads] = useState(null) // null = carregando
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ chain: '', neighborhood: '', validDays: '7', append: false })
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const fileInput = useRef(null)

  const reload = useCallback(async () => {
    try {
      setUploads(await listFlyers())
      setLoadError('')
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    listChains().then(setChains).catch(() => {})
    reload()
  }, [reload])

  // Enquanto algum envio estiver sendo lido, consulta de poucos em poucos segundos.
  const reading = uploads?.some((u) => u.status === 'PROCESSING') ?? false
  useEffect(() => {
    if (!reading) return undefined
    const timer = setInterval(reload, POLL_MS)
    return () => clearInterval(timer)
  }, [reading, reload])

  // Avisa quando um envio que estava sendo lido termina.
  const seen = useRef(new Map())
  useEffect(() => {
    for (const u of uploads ?? []) {
      if (seen.current.get(u.id) === 'PROCESSING' && u.status !== 'PROCESSING') {
        if (u.status === 'SUCCESS') notify('Encarte publicado', `${u.chain.name}: ${u.itemsExtracted} oferta(s) no ar.`)
        else notify('Encarte não publicado', u.error ?? 'Falha ao ler o arquivo.', 'error')
      }
      seen.current.set(u.id, u.status)
    }
  }, [uploads, notify])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const validDays = Number(form.validDays)
    const problem =
      (!form.chain && 'Escolha a rede.') ||
      (!Number.isInteger(validDays) || validDays < 1 || validDays > 30 ? 'A validade deve ser de 1 a 30 dias.' : '') ||
      fileProblem(file)
    if (problem) return setError(problem)

    setError('')
    setSending(true)
    try {
      await uploadFlyer({ chain: form.chain, neighborhood: form.neighborhood.trim(), validDays, append: form.append, file })
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      notify('Encarte enviado', 'Estamos lendo as ofertas. Pode levar alguns minutos.')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <h1 className="page-title">Encartes dos mercados</h1>
      <p className="sub">
        Envie o encarte da sua rede (PDF ou foto). Lemos as ofertas e publicamos em “Ofertas do bairro”, com cupom de retirada para
        descontos a partir de 15%.
      </p>

      <section className="panel" style={{ marginBottom: 20 }}>
        <form onSubmit={submit} noValidate>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="fl-chain">Rede</label>
              <select id="fl-chain" value={form.chain} onChange={set('chain')} required>
                <option value="">Escolha…</option>
                {chains.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fl-hood">Bairro da loja (opcional)</label>
              <input id="fl-hood" value={form.neighborhood} onChange={set('neighborhood')} placeholder="Ex.: Aldeota" maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="fl-days">Válido por (dias)</label>
              <input id="fl-days" type="number" min="1" max="30" value={form.validDays} onChange={set('validDays')} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="fl-file">Arquivo do encarte</label>
            <input id="fl-file" ref={fileInput} type="file" accept={FLYER_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="muted">PDF até {mb(FLYER_LIMITS.pdf)} · JPEG, PNG ou WebP até {mb(FLYER_LIMITS.image)}.</span>
          </div>

          <label className="deal-check" style={{ marginBottom: 14, whiteSpace: 'normal', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={form.append} onChange={set('append')} /> É mais uma página do mesmo encarte (não apagar as ofertas já enviadas)
          </label>

          {error && <p className="deal-notice err" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={sending}>{sending ? 'Enviando…' : 'Enviar encarte'}</button>
        </form>
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Meus envios</h2>
      {loadError ? (
        <p className="muted">
          {loadError} <button className="btn sm" type="button" onClick={reload}>Tentar de novo</button>
        </p>
      ) : uploads === null ? (
        <p className="muted">Carregando envios…</p>
      ) : uploads.length === 0 ? (
        <p className="muted">Nenhum encarte enviado ainda.</p>
      ) : (
        <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th>Enviado em</th>
                <th>Rede</th>
                <th>Arquivo</th>
                <th>Status</th>
                <th>Ofertas</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>{when(u.createdAt)}</td>
                  <td>
                    {u.chain.name}
                    {u.neighborhood && <><br /><span className="muted">{u.neighborhood}</span></>}
                  </td>
                  <td>
                    {u.fileName ?? '—'}
                    <br />
                    <span className="muted">{mb(u.sizeBytes)}</span>
                  </td>
                  <td>
                    <span className={`tag ${STATUS[u.status][0]}`}>{STATUS[u.status][1]}</span>
                    {u.error && <><br /><span className="muted">{u.error}</span></>}
                  </td>
                  <td>
                    {u.status === 'SUCCESS' ? u.itemsExtracted : '—'}
                    {u.itemsDropped > 0 && <><br /><span className="muted">{u.itemsDropped} descartada(s)</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
