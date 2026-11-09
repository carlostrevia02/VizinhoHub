import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { ARROZ_ZE, CREME, IOGURTE, LUCIA, MARIA, PAO, SUCO_LUCIA, startTestEnv, tokenFor, ZE, type TestEnv } from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
before(async () => {
  t = await startTestEnv(54332)
})
after(() => t?.stop())

// "Hoje" é o dia de Fortaleza (igual ao current_date do banco), não o UTC.
const isoDay = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' })

describe('GET /categories', () => {
  it('lista departamentos com a contagem de produtos vendáveis', async () => {
    const res = await t.api('GET', '/api/v1/categories')
    assert.equal(res.status, 200)
    const mercearia = res.body.find((c: { name: string }) => c.name === 'Mercearia')
    assert.equal(mercearia.productCount, 2) // arroz do Zé + arroz da Lúcia
  })

  it('só comerciante cria categoria; nome repetido → 409', async () => {
    assert.equal((await t.api('POST', '/api/v1/categories', { token: tokenFor(MARIA), body: { name: 'Pet' } })).status, 403)
    const created = await t.api('POST', '/api/v1/categories', { token: ze(), body: { name: 'Pet' } })
    assert.equal(created.status, 201)
    assert.equal((await t.api('POST', '/api/v1/categories', { token: ze(), body: { name: 'Pet' } })).status, 409)
  })
})

describe('GET /products (vitrine pública)', () => {
  it('é pública e mostra o preço final do Salva-Estoque sem campos internos', async () => {
    const res = await t.api('GET', '/api/v1/products')
    assert.equal(res.status, 200)
    assert.equal(res.body.length, 6)
    const iogurte = res.body.find((p: { id: string }) => p.id === IOGURTE)
    assert.equal(iogurte.price, 3.89)
    assert.equal(iogurte.effectivePrice, 2.72)
    assert.equal(iogurte.discountPct, 30)
    assert.equal(iogurte.isClearance, true)
    assert.equal(iogurte.store.name, 'Mercadinho do Zé')
    for (const hidden of ['barcode', 'active', 'allowB2bSharing', 'b2bReserveQty']) assert.equal(hidden in iogurte, false, hidden)
  })

  it('filtra por busca sem acento/caixa, categoria, loja, oferta e estoque', async () => {
    const ids = async (qs: string) => (await t.api('GET', `/api/v1/products?${qs}`)).body.map((p: { id: string }) => p.id).sort()

    assert.deepEqual(await ids('search=IOGÚRTE'), [IOGURTE])
    assert.deepEqual(await ids('search=pao'), [PAO]) // "Pão" sem acento
    assert.deepEqual(await ids('search=%25'), []) // % é literal, não coringa
    assert.deepEqual(await ids('clearance=true'), [IOGURTE, PAO].sort())
    assert.deepEqual(await ids(`merchantId=${LUCIA}`), [SUCO_LUCIA, 'bbbbbbbb-0000-4000-8000-000000000001'].sort())
    assert.deepEqual(await ids('inStock=false'), [ARROZ_ZE])
    assert.equal((await ids('category=3')).length, 1) // Bebidas
    assert.equal((await t.api('GET', '/api/v1/products?limit=2&offset=1')).body.length, 2)
    assert.equal((await t.api('GET', '/api/v1/products?limit=9999')).status, 400)
  })

  it('GET /products/:id devolve um produto; id inexistente → 404, id malformado → 400', async () => {
    assert.equal((await t.api('GET', `/api/v1/products/${CREME}`)).body.name, 'Creme de Leite Nestlé 200g')
    assert.equal((await t.api('GET', '/api/v1/products/aaaaaaaa-0000-4000-8000-0000000000ff')).status, 404)
    assert.equal((await t.api('GET', '/api/v1/products/abc')).status, 400)
  })
})

describe('produtos do comerciante', () => {
  const body = { name: 'Leite Integral 1L', categoryId: 2, price: 5.49, stockQty: 10, barcode: '7891234567895', unit: 'Litro' }
  let id: string

  it('só comerciante cadastra (401/403) e o corpo é validado (400)', async () => {
    assert.equal((await t.api('POST', '/api/v1/products', { body })).status, 401)
    assert.equal((await t.api('POST', '/api/v1/products', { token: tokenFor(MARIA), body })).status, 403)
    assert.equal((await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, price: -1 } })).status, 400)
    assert.equal((await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, price: 1.234 } })).status, 400)
    assert.equal((await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, barcode: 'abc' } })).status, 400)
    assert.equal((await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, categoryId: 999 } })).status, 422)
  })

  it('cadastra com a loja do token (ignora merchantId do corpo) e aparece na vitrine', async () => {
    const res = await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, merchantId: LUCIA, userId: LUCIA } })
    assert.equal(res.status, 201)
    id = res.body.id
    assert.equal(res.body.merchantId, ZE)
    assert.equal(res.body.effectivePrice, 5.49)
    assert.equal(res.body.isClearance, false)
    assert.equal((await t.api('GET', `/api/v1/products/${id}`)).status, 200)
  })

  it('validade próxima vira oferta automaticamente (Salva-Estoque)', async () => {
    const tomorrow = await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, name: 'Requeijão', price: 10, expirationDate: isoDay(1) } })
    assert.equal(tomorrow.body.isClearance, true)
    assert.equal(tomorrow.body.discountPct, 50)
    assert.equal(tomorrow.body.effectivePrice, 5)

    // Editar a validade para longe desliga a oferta.
    const moved = await t.api('PUT', `/api/v1/products/${tomorrow.body.id}`, { token: ze(), body: { expirationDate: isoDay(60) } })
    assert.equal(moved.body.isClearance, false)
    assert.equal(moved.body.effectivePrice, 10)
  })

  it('vencido some da vitrine mas continua no painel do comerciante', async () => {
    const expired = await t.api('POST', '/api/v1/products', { token: ze(), body: { ...body, name: 'Iogurte vencido', expirationDate: isoDay(-1) } })
    assert.equal(expired.status, 201)
    assert.equal((await t.api('GET', `/api/v1/products/${expired.body.id}`)).status, 404)
    const mine = await t.api('GET', '/api/v1/products/mine', { token: ze() })
    assert.ok(mine.body.some((p: { id: string }) => p.id === expired.body.id))
    const order = await t.api('POST', '/api/v1/orders', { token: tokenFor(MARIA), body: { items: [{ productId: expired.body.id, quantity: 1 }] } })
    assert.equal(order.status, 409)
    assert.equal(order.body.error.code, 'PRODUCT_UNAVAILABLE')
  })

  it('PUT atualiza campos enviados; produto de outra loja → 404', async () => {
    const res = await t.api('PUT', `/api/v1/products/${id}`, { token: ze(), body: { price: 5.99, allowB2bSharing: true, b2bReserveQty: 2 } })
    assert.equal(res.status, 200)
    assert.equal(res.body.price, 5.99)
    assert.equal(res.body.name, 'Leite Integral 1L')
    assert.equal(res.body.unit, 'Litro', 'campo não enviado no PUT é preservado (não volta ao padrão)')
    assert.equal(res.body.barcode, '7891234567895')
    assert.equal(res.body.allowB2bSharing, true)
    assert.equal((await t.api('PUT', `/api/v1/products/${id}`, { token: tokenFor(LUCIA), body: { price: 0.01 } })).status, 404)
    assert.equal((await t.api('PUT', `/api/v1/products/${id}`, { token: ze(), body: {} })).status, 400)
    // estoque não muda por PUT (só pelo ajuste atômico)
    const ignored = await t.api('PUT', `/api/v1/products/${id}`, { token: ze(), body: { stockQty: 999 } })
    assert.equal(ignored.status === 400 || ignored.body.stockQty === 10, true)
  })

  it('PATCH /stock: entrada, saída, contagem e saída maior que o saldo → 422', async () => {
    const stock = (b: object, token = ze()) => t.api('PATCH', `/api/v1/products/${id}/stock`, { token, body: b })
    assert.equal((await stock({ delta: 5 })).body.stockQty, 15)
    assert.equal((await stock({ delta: -15 })).body.stockQty, 0)

    const over = await stock({ delta: -1 })
    assert.equal(over.status, 422)
    assert.equal(over.body.error.code, 'INSUFFICIENT_STOCK')
    assert.equal((await t.db.query('SELECT stock_qty FROM products WHERE id = $1', [id])).rows[0].stock_qty, 0)

    assert.equal((await stock({ set: 40 })).body.stockQty, 40)
    assert.equal((await stock({ delta: 0 })).status, 400)
    assert.equal((await stock({})).status, 400)
    assert.equal((await stock({ delta: 1 }, tokenFor(LUCIA))).status, 404)
  })

  it('saídas simultâneas nunca deixam o estoque negativo', async () => {
    await t.api('PATCH', `/api/v1/products/${id}/stock`, { token: ze(), body: { set: 10 } })
    const results = await Promise.all(
      Array.from({ length: 8 }, () => t.api('PATCH', `/api/v1/products/${id}/stock`, { token: ze(), body: { delta: -3 } })),
    )
    const ok = results.filter((r) => r.status === 200).length
    assert.equal(ok, 3) // 10 / 3 = 3 saídas
    assert.deepEqual([...new Set(results.filter((r) => r.status !== 200).map((r) => r.status))], [422])
    assert.equal((await t.db.query('SELECT stock_qty FROM products WHERE id = $1', [id])).rows[0].stock_qty, 1)
  })

  it('DELETE faz remoção lógica: some da vitrine e do painel, e não recebe mais pedidos', async () => {
    assert.equal((await t.api('DELETE', `/api/v1/products/${id}`, { token: tokenFor(LUCIA) })).status, 404)
    assert.equal((await t.api('DELETE', `/api/v1/products/${id}`, { token: ze() })).status, 204)
    assert.equal((await t.api('GET', `/api/v1/products/${id}`)).status, 404)
    assert.equal((await t.api('GET', '/api/v1/products/mine', { token: ze() })).body.some((p: { id: string }) => p.id === id), false)
    assert.equal((await t.api('DELETE', `/api/v1/products/${id}`, { token: ze() })).status, 404)
    const row = (await t.db.query('SELECT active FROM products WHERE id = $1', [id])).rows[0]
    assert.equal(row.active, false)
  })
})
