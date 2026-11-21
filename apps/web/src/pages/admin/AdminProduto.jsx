import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { api } from '../../lib/api'
import { imgSrc } from '../../lib/catalog'
import { isoDay } from '../../lib/caderneta'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const toNumber = (v) => Number(String(v).trim().replace(',', '.'))
const EMPTY = {
  name: '', categoryId: '', unit: 'Unidade', description: '', price: '',
  expirationDate: '', barcode: '', image: '',
}

function AdminProduto() {
  const [params] = useSearchParams()
  const id = params.get('id')
  const { products, productsError } = useAdmin()

  if (!id) return <ProdutoForm key="new" />
  if (productsError) return <p className="muted">Não foi possível carregar o produto.</p>
  if (!products) return <p className="muted">Carregando produto…</p>
  const product = products.find((p) => p.id === id)
  if (!product) {
    return (
      <>
        <h1 className="page-title">Produto não encontrado</h1>
        <Link className="btn" to="/meus-produtos">Voltar para meus produtos</Link>
      </>
    )
  }
  return <ProdutoForm key={id} product={product} />
}

function ProdutoForm({ product }) {
  const editing = Boolean(product)
  useDocumentTitle(`${editing ? 'Editar produto' : 'Novo produto'} — VizinhoHub Manager`)
  const navigate = useNavigate()
  const { categories, reloadProducts, notify } = useAdmin()
  const [form, setForm] = useState(
    product
      ? {
          name: product.name,
          categoryId: String(product.category.id),
          unit: product.unit,
          description: product.description ?? '',
          price: String(product.price).replace('.', ','),
          expirationDate: product.expirationDate ?? '',
          barcode: product.barcode ?? '',
          image: product.image ?? '',
        }
      : EMPTY,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({}) // mensagem por campo (name, categoryId, price, expirationDate)
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
    setFieldErrors((fe) => (fe[k] ? { ...fe, [k]: undefined } : fe))
  }
  const FieldError = ({ name }) => (fieldErrors[name] ? <span className="hint" id={`err-${name}`} role="alert" style={{ color: 'var(--red)' }}>{fieldErrors[name]}</span> : null)

  const price = toNumber(form.price)
  const preview = {
    name: form.name || 'Nome do produto',
    img: form.image.trim() || null,
    price: Number.isFinite(price) ? price : 0,
  }

  const save = async (e) => {
    e.preventDefault()
    setError('')
    const problems = {}
    if (form.name.trim().length < 2) problems.name = 'Informe o nome do produto (mínimo 2 letras).'
    if (!form.categoryId) problems.categoryId = 'Escolha o departamento.'
    const priceText = form.price.trim().replace(',', '.')
    if (priceText === '' || !Number.isFinite(price)) problems.price = 'Informe um preço válido (ex.: 4,29).'
    else if (price <= 0) problems.price = 'O preço precisa ser maior que R$ 0,00.'
    else if (!/^\d+(\.\d{1,2})?$/.test(priceText)) problems.price = 'Use no máximo 2 casas decimais (ex.: 4,29).'
    if (form.expirationDate && form.expirationDate < isoDay(0)) problems.expirationDate = 'A validade não pode estar no passado.'
    if (form.barcode.trim() && !/^\d{8,14}$/.test(form.barcode.trim())) problems.barcode = 'O código de barras deve ter de 8 a 14 dígitos.'
    setFieldErrors(problems)
    if (Object.keys(problems).length) return setError('Corrija os campos destacados.')

    const fields = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      categoryId: Number(form.categoryId),
      price,
      unit: form.unit.trim() || 'Unidade',
      image: form.image.trim() || null,
      expirationDate: form.expirationDate || null,
      barcode: form.barcode.trim() || null,
    }
    setBusy(true)
    try {
      if (editing) {
        await api.put(`/products/${product.id}`, fields)
      } else {
        await api.post('/products', fields)
      }
      await reloadProducts()
      notify(editing ? 'Produto atualizado' : 'Produto cadastrado', fields.name)
      navigate('/meus-produtos')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <nav className="crumbs">
        <Link to="/meus-produtos">Meus produtos</Link> › <span>{editing ? 'Editar produto' : 'Novo produto'}</span>
      </nav>
      <div className="row" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title">{editing ? 'Editar produto' : 'Cadastrar produto'}</h1>
          <p className="sub" style={{ margin: 0 }}>Preencha os dados e veja como o card aparece na vitrine.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link className="btn ghost" to="/meus-produtos">Cancelar</Link>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar produto'}</button>
        </div>
      </div>
      {error && <p className="form-msg error" role="alert">{error}</p>}
      <div className="grid-2">
        <div style={{ display: 'grid', gap: '18px' }}>
          <section className="panel">
            <h3>Informações básicas</h3>
            <div className="field">
              <label htmlFor="n">Nome do produto</label>
              <input id="n" required minLength={2} maxLength={160} aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'err-name' : undefined} value={form.name} onChange={set('name')} placeholder="Ex.: Açúcar refinado 1kg" />
              <FieldError name="name" />
            </div>
            <div className="two">
              <div className="field">
                <label htmlFor="d">Departamento</label>
                <select id="d" required aria-invalid={!!fieldErrors.categoryId} value={form.categoryId} onChange={set('categoryId')}>
                  <option value="" disabled>Escolha…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <FieldError name="categoryId" />
              </div>
              <div className="field">
                <label htmlFor="u">Unidade de venda</label>
                <select id="u" value={form.unit} onChange={set('unit')}>
                  <option>Unidade</option>
                  <option>kg</option>
                  {!['Unidade', 'kg'].includes(form.unit) && <option>{form.unit}</option>}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ds">Descrição</label>
              <textarea id="ds" rows="4" maxLength={2000} value={form.description} onChange={set('description')} />
            </div>
          </section>

          <section className="panel">
            <h3>Preço e validade</h3>
            <div className="two">
              <div className="field">
                <label htmlFor="p1">Preço (R$)</label>
                <input id="p1" required inputMode="decimal" aria-invalid={!!fieldErrors.price} value={form.price} onChange={set('price')} placeholder="0,00" />
                <FieldError name="price" />
              </div>
              <div className="field">
                <label htmlFor="ex">Validade (opcional)</label>
                <input id="ex" type="date" aria-invalid={!!fieldErrors.expirationDate} value={form.expirationDate} onChange={set('expirationDate')} />
                <FieldError name="expirationDate" />
                <span className="hint">Perto do vencimento, o Salva-Estoque aplica o desconto automaticamente.</span>
              </div>
              <div className="field">
                <label htmlFor="bc">Código de barras (opcional)</label>
                <input id="bc" inputMode="numeric" pattern="\d{8,14}" title="De 8 a 14 dígitos" aria-invalid={!!fieldErrors.barcode} value={form.barcode} onChange={set('barcode')} />
                <FieldError name="barcode" />
              </div>
            </div>
          </section>
        </div>

        <div style={{ display: 'grid', gap: '18px' }}>
          <section className="panel">
            <h3>Imagem</h3>
            <div className="dropzone">
              <img src={imgSrc(preview)} alt="" width="400" height="400" />
              <div className="field" style={{ width: '100%', marginBottom: 0 }}>
                <label htmlFor="im">Arquivo em /img (opcional)</label>
                <input id="im" value={form.image} onChange={set('image')} placeholder="ex.: aveia.png" />
              </div>
            </div>
          </section>
          <section>
            <h3 style={{ margin: '0 0 10px', color: 'var(--dark)' }}>Pré-visualização</h3>
            <div style={{ maxWidth: '230px' }}>
              <article className="card">
                <span className="thumb">
                  <img src={imgSrc(preview)} alt="" width="400" height="400" />
                </span>
                <h3>{preview.name}</h3>
                <div className="prices">
                  <s className="ghost">&nbsp;</s>
                  <span className="price">{formatBRL(preview.price)}</span>
                </div>
                <button className="btn" type="button" disabled>+ Adicionar</button>
              </article>
            </div>
          </section>
        </div>
      </div>
    </form>
  )
}

export default AdminProduto
