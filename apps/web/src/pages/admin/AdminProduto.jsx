import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { api } from '../../lib/api'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const toNumber = (v) => Number(String(v).trim().replace(',', '.'))
const EMPTY = {
  name: '', categoryId: '', unit: 'Unidade', description: '', price: '', stock: '0',
  expirationDate: '', barcode: '', image: '', allowB2bSharing: false, b2bReserveQty: '0',
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
        <Link className="btn" to="/estoque">Voltar ao estoque</Link>
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
          stock: String(product.stockQty),
          expirationDate: product.expirationDate ?? '',
          barcode: product.barcode ?? '',
          image: product.image ?? '',
          allowB2bSharing: product.allowB2bSharing,
          b2bReserveQty: String(product.b2bReserveQty),
        }
      : EMPTY,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const price = toNumber(form.price)
  const stock = toNumber(form.stock)
  const preview = {
    name: form.name || 'Nome do produto',
    img: form.image.trim() || null,
    price: Number.isFinite(price) ? price : 0,
    stock: Number.isFinite(stock) ? stock : 0,
  }

  const save = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.categoryId) return setError('Escolha o departamento.')
    if (!Number.isFinite(price) || form.price.trim() === '') return setError('Informe um preço válido (ex.: 4,29).')
    if (!Number.isInteger(stock) || stock < 0) return setError('O estoque precisa ser um número inteiro, 0 ou mais.')
    const reserve = toNumber(form.b2bReserveQty)
    if (!Number.isInteger(reserve) || reserve < 0) return setError('A reserva B2B precisa ser um número inteiro, 0 ou mais.')

    const fields = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      categoryId: Number(form.categoryId),
      price,
      unit: form.unit.trim() || 'Unidade',
      image: form.image.trim() || null,
      expirationDate: form.expirationDate || null,
      barcode: form.barcode.trim() || null,
      allowB2bSharing: form.allowB2bSharing,
      b2bReserveQty: reserve,
    }
    setBusy(true)
    try {
      if (editing) {
        await api.put(`/products/${product.id}`, fields)
        if (stock !== product.stockQty) await api.patch(`/products/${product.id}/stock`, { set: stock })
      } else {
        await api.post('/products', { ...fields, stockQty: stock })
      }
      await reloadProducts()
      notify(editing ? 'Produto atualizado' : 'Produto cadastrado', fields.name)
      navigate('/estoque')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save}>
      <nav className="crumbs">
        <Link to="/estoque">Estoque</Link> › <span>{editing ? 'Editar produto' : 'Novo produto'}</span>
      </nav>
      <div className="row" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title">{editing ? 'Editar produto' : 'Cadastrar produto'}</h1>
          <p className="sub" style={{ margin: 0 }}>Preencha os dados e veja como o card aparece na vitrine.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link className="btn ghost" to="/estoque">Cancelar</Link>
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
              <input id="n" required minLength={2} maxLength={160} value={form.name} onChange={set('name')} placeholder="Ex.: Açúcar refinado 1kg" />
            </div>
            <div className="two">
              <div className="field">
                <label htmlFor="d">Departamento</label>
                <select id="d" required value={form.categoryId} onChange={set('categoryId')}>
                  <option value="" disabled>Escolha…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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
            <h3>Preço e estoque</h3>
            <div className="two">
              <div className="field">
                <label htmlFor="p1">Preço (R$)</label>
                <input id="p1" required inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0,00" />
              </div>
              <div className="field">
                <label htmlFor="e1">Estoque atual</label>
                <input id="e1" required inputMode="numeric" value={form.stock} onChange={set('stock')} />
              </div>
              <div className="field">
                <label htmlFor="ex">Validade (opcional)</label>
                <input id="ex" type="date" value={form.expirationDate} onChange={set('expirationDate')} />
                <span className="hint">Perto do vencimento, o Salva-Estoque aplica o desconto automaticamente.</span>
              </div>
              <div className="field">
                <label htmlFor="bc">Código de barras (opcional)</label>
                <input id="bc" inputMode="numeric" pattern="\d{8,14}" title="De 8 a 14 dígitos" value={form.barcode} onChange={set('barcode')} />
              </div>
            </div>
          </section>

          <section className="panel">
            <h3>Rede B2B</h3>
            <div className="setting">
              <div>
                <strong>Compartilhar com a rede B2B</strong>
                <small>Outros mercadinhos podem pedir este item emprestado quando faltar para eles</small>
              </div>
              <label className="switch">
                <input type="checkbox" checked={form.allowB2bSharing} onChange={set('allowB2bSharing')} aria-label="Compartilhar com a rede B2B" />
                <span />
              </label>
            </div>
            {form.allowB2bSharing && (
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="rb">Reserva para a loja (unidades que não entram no compartilhamento)</label>
                <input id="rb" inputMode="numeric" value={form.b2bReserveQty} onChange={set('b2bReserveQty')} />
              </div>
            )}
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
                <span className="muted">{preview.stock} em estoque</span>
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
