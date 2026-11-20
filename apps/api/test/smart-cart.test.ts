// Carrinho Inteligente: otimizador (função pura), heurística de vínculo canônico e rotas (receitas, listas, otimizar).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { applyVipPct } from '../src/modules/vip/vip.discount.js'
import { optimize, type OptimizerOffer, type OptimizerStore } from '../src/modules/smart-cart/smart-cart.optimizer.js'
import { linkCatalog, matchCanonical, normalizeName, RECIPES, seedReferenceData } from '../src/modules/smart-cart/smart-cart.seed.js'
import { ARROZ_LUCIA, ARROZ_ZE, CREME, IOGURTE, LUCIA, MARIA, ZE, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

// ---- função pura -------------------------------------------------------------------------------------

const offer = (merchantId: string, canonicalId: number, priceCents: number, available = 99): OptimizerOffer => ({ merchantId, canonicalId, priceCents, available })
const store = (merchantId: string, feeCents = 0) => ({ merchantId, feeCents })

describe('optimize() · função pura', () => {
  it('uma loja vence: tudo mais barato num lugar só', () => {
    const r = optimize({
      items: [{ canonicalId: 1, quantity: 2 }, { canonicalId: 2, quantity: 1 }],
      stores: [store('A'), store('B')],
      offers: [offer('A', 1, 500), offer('A', 2, 1000), offer('B', 1, 600), offer('B', 2, 1100)],
    })
    assert.deepEqual(r.single!.merchantIds, ['A'])
    assert.equal(r.single!.totalCents, 2000)
    assert.deepEqual(r.split!.merchantIds, ['A'], 'dividir não ajuda: o plano global coincide com a loja única')
    assert.equal(r.split!.totalCents, 2000)
    assert.deepEqual(r.unavailable, [])
  })

  it('dividir vence por causa do preço (sem frete)', () => {
    const r = optimize({
      items: [{ canonicalId: 1, quantity: 1 }, { canonicalId: 2, quantity: 1 }],
      stores: [store('A'), store('B')],
      offers: [offer('A', 1, 100), offer('A', 2, 900), offer('B', 1, 500), offer('B', 2, 200)],
    })
    assert.equal(r.single!.totalCents, 700, 'melhor loja única: B (500 + 200)')
    assert.deepEqual(r.single!.merchantIds, ['B'])
    assert.equal(r.split!.totalCents, 300, 'A leva o item 1 e B leva o item 2')
    assert.deepEqual(r.split!.merchantIds, ['A', 'B'])
    assert.deepEqual(r.split!.lines.map((l) => [l.canonicalId, l.merchantId]), [[1, 'A'], [2, 'B']])
  })

  it('o frete faz a divisão perder', () => {
    const r = optimize({
      items: [{ canonicalId: 1, quantity: 1 }, { canonicalId: 2, quantity: 1 }],
      stores: [store('A', 800), store('B', 800)],
      offers: [offer('A', 1, 100), offer('A', 2, 900), offer('B', 1, 500), offer('B', 2, 200)],
    })
    // dividir: 100 + 200 + 1600 de frete = 1900; só B: 700 + 800 = 1500; só A: 1000 + 800 = 1800.
    assert.deepEqual(r.split!.merchantIds, ['B'])
    assert.equal(r.split!.totalCents, 1500)
    assert.equal(r.split!.feesCents, 800)
    assert.equal(r.split!.itemsCents, 700)
    assert.deepEqual(r.single, r.split)
  })

  it('item faltante: fica fora, e o plano que cobre mais itens vem primeiro', () => {
    const r = optimize({
      items: [{ canonicalId: 1, quantity: 1 }, { canonicalId: 2, quantity: 1 }, { canonicalId: 3, quantity: 1 }],
      stores: [store('A'), store('B')],
      offers: [offer('A', 1, 100), offer('B', 1, 100), offer('B', 2, 5000)],
    })
    assert.deepEqual(r.unavailable, [3], 'ninguém vende o item 3')
    // A é mais barata (só 1 item), mas B cobre 2 itens: cobertura vence custo.
    assert.deepEqual(r.single!.merchantIds, ['B'])
    assert.deepEqual(r.single!.missing, [3])
    assert.equal(r.single!.totalCents, 5100)
    assert.deepEqual(r.split!.missing, [3])
  })

  it('oferta sem saldo para a quantidade é ignorada; empate de preço fica com a loja mais próxima', () => {
    const r = optimize({
      items: [{ canonicalId: 1, quantity: 3 }],
      stores: [store('A'), store('B'), store('C')],
      offers: [offer('A', 1, 100, 2), offer('B', 1, 200), offer('C', 1, 200)],
    })
    assert.deepEqual(r.single!.merchantIds, ['B'], 'A só tem 2 unidades; B e C empatam e B vem antes')
    assert.equal(r.single!.totalCents, 600)
  })

  it('usa a oferta mais barata da mesma loja (ex.: oferta relâmpago ao lado do preço normal)', () => {
    const flash: OptimizerOffer = { merchantId: 'A', canonicalId: 1, priceCents: 300, available: 2, meta: 'flash' }
    const r = optimize({ items: [{ canonicalId: 1, quantity: 2 }], stores: [store('A')], offers: [offer('A', 1, 500), flash] })
    assert.equal(r.single!.lines[0]!.unitCents, 300)
    assert.equal(r.single!.lines[0]!.meta, 'flash')
    const r3 = optimize({ items: [{ canonicalId: 1, quantity: 3 }], stores: [store('A')], offers: [offer('A', 1, 500), flash] })
    assert.equal(r3.single!.lines[0]!.unitCents, 500, 'a oferta só cobre 2 unidades')
  })

  it('respeita maxStores e funciona com 8 lojas (92 combinações)', () => {
    const stores = Array.from({ length: 8 }, (_, i) => store(`S${i}`))
    const items = Array.from({ length: 4 }, (_, i) => ({ canonicalId: i + 1, quantity: 1 }))
    // Cada loja é a mais barata de exatamente 1 item: dividir em 4 lojas seria o ótimo, mas maxStores = 2 limita.
    const offers: OptimizerOffer[] = []
    for (const s of stores) for (const i of items) offers.push(offer(s.merchantId, i.canonicalId, s.merchantId === `S${i.canonicalId - 1}` ? 100 : 1000))
    const two = optimize({ items, stores, offers, maxStores: 2 })
    assert.equal(two.split!.merchantIds.length, 2)
    assert.equal(two.split!.totalCents, 100 + 100 + 1000 + 1000)
    const three = optimize({ items, stores, offers, maxStores: 3 })
    assert.equal(three.split!.totalCents, 300 + 1000)
    assert.equal(three.single!.totalCents, 100 + 3000)
  })

  it('sem lojas ou sem ofertas: nenhum plano', () => {
    const r = optimize({ items: [{ canonicalId: 1, quantity: 1 }], stores: [], offers: [] })
    assert.equal(r.single, null)
    assert.equal(r.split, null)
    assert.deepEqual(r.unavailable, [1])
  })
})

// ---- heurística de vínculo ---------------------------------------------------------------------------

describe('optimize() · Clube VIP', () => {
  const vipStore = (merchantId: string, feeCents: number, vipPct: number, vipFreeMinCents: number | null = null): OptimizerStore => ({ merchantId, feeCents, vipPct, vipFreeMinCents })

  it('o desconto VIP muda o vencedor entre loja aderente e não aderente', () => {
    const offers = [offer('A', 1, 1000), offer('B', 1, 1050)]
    const items = [{ canonicalId: 1, quantity: 1 }]
    const semVip = optimize({ items, stores: [store('A'), store('B')], offers })
    assert.deepEqual(semVip.single!.merchantIds, ['A'])
    // B aderiu com 10 %: 1050 -> 945, menos que os 1000 de A.
    const comVip = optimize({ items, stores: [store('A'), vipStore('B', 0, 10)], offers })
    assert.deepEqual(comVip.single!.merchantIds, ['B'])
    assert.equal(comVip.single!.totalCents, 945)
    assert.equal(comVip.single!.vipSavingsCents, 105)
    assert.equal(comVip.single!.lines[0]!.listUnitCents, 1050)
    assert.equal(comVip.single!.stores[0]!.vipPct, 10)
  })

  it('frete grátis só quando o total da loja, já com desconto, atinge o mínimo (e entra na escolha)', () => {
    const items = [{ canonicalId: 1, quantity: 1 }]
    // 3000 - 10 % = 2700: abaixo do mínimo de 2800 -> paga a taxa de 650.
    const abaixo = optimize({ items, stores: [vipStore('A', 650, 10, 2800)], offers: [offer('A', 1, 3000)] })
    assert.equal(abaixo.single!.feesCents, 650)
    assert.equal(abaixo.single!.stores[0]!.freeDeliveryVip, false)
    // Mínimo exatamente igual ao total com desconto -> grátis.
    const igual = optimize({ items, stores: [vipStore('A', 650, 10, 2700)], offers: [offer('A', 1, 3000)] })
    assert.equal(igual.single!.feesCents, 0)
    assert.equal(igual.single!.totalCents, 2700)
    assert.equal(igual.single!.stores[0]!.freeDeliveryVip, true)
    assert.equal(igual.single!.stores[0]!.baseFeeCents, 650)
    // Sem taxa (retirada) não há o que zerar: não marca como frete grátis VIP.
    const retirada = optimize({ items, stores: [vipStore('A', 0, 10, 100)], offers: [offer('A', 1, 3000)] })
    assert.equal(retirada.single!.stores[0]!.freeDeliveryVip, false)
    // A loja mais cara na prateleira vence porque o frete dela fica grátis.
    const r = optimize({ items, stores: [store('A', 650), vipStore('B', 650, 0, 3050)], offers: [offer('A', 1, 3000), offer('B', 1, 3050)] })
    assert.deepEqual(r.single!.merchantIds, ['B'])
    assert.equal(r.single!.totalCents, 3050)
  })

  it('oferta relâmpago não recebe o desconto VIP; o item normal da mesma loja recebe', () => {
    const r = optimize({
      items: [{ canonicalId: 1, quantity: 2 }, { canonicalId: 2, quantity: 1 }],
      stores: [vipStore('A', 0, 10)],
      offers: [{ ...offer('A', 1, 600), flash: true }, offer('A', 2, 1000)],
    })
    const [flash, normal] = r.single!.lines
    assert.equal(flash!.unitCents, 600)
    assert.equal(flash!.listUnitCents, 600)
    assert.equal(normal!.unitCents, 900)
    assert.equal(r.single!.vipSavingsCents, 100)
    // Preço normal de 640 com 10 % vira 576, que bate a relâmpago de 600.
    const disputa = optimize({
      items: [{ canonicalId: 1, quantity: 1 }],
      stores: [vipStore('A', 0, 10)],
      offers: [{ ...offer('A', 1, 600), flash: true }, offer('A', 1, 640)],
    })
    assert.equal(disputa.single!.lines[0]!.unitCents, 576)
  })

  it('arredonda por unidade, igual ao pedido (applyVipPct)', () => {
    for (const [price, pct, qty] of [[429, 2, 10], [333, 7.5, 3], [199, 12.5, 7], [1, 2, 5]] as const) {
      const r = optimize({ items: [{ canonicalId: 1, quantity: qty }], stores: [vipStore('A', 0, pct)], offers: [offer('A', 1, price)] })
      const server = applyVipPct([{ unitPrice: (price / 100).toFixed(2), quantity: qty, flashOfferId: null }], pct)
      assert.equal(r.single!.itemsCents, Math.round(Number(server.total) * 100), `${price} @ ${pct}% x ${qty}`)
      assert.equal(r.single!.vipSavingsCents, Math.round(server.savings * 100))
    }
  })
})

describe('vínculo canônico · heurística de nome', () => {
  const match = (name: string) => {
    const m = matchCanonical(name)
    return m === null || m === 'ambiguous' ? m : m.name
  }

  it('normaliza acento, caixa e gramatura', () => {
    assert.equal(normalizeName('Açúcar União 1 Kg'), 'acucar uniao 1kg')
    assert.equal(normalizeName('Leite Integral 1,5 L'), 'leite integral 1.5l')
  })

  it('vincula o que é claramente o mesmo item, ignorando a marca', () => {
    assert.equal(match('Arroz Camil Integral 1kg'), 'Arroz integral 1 kg')
    assert.equal(match('Feijão Carioca Fibra 1kg'), 'Feijão carioca 1 kg')
    assert.equal(match('Leite Integral Caraúba 1L'), 'Leite integral 1 L')
    assert.equal(match('Cebola (kg)'), 'Cebola (kg)')
    assert.equal(match('Creme de Leite Nestlé Caixa 200g'), 'Creme de leite 200 g')
  })

  it('é conservador: variações que mudam o produto ficam sem vínculo', () => {
    assert.equal(match('Cebola Roxa (kg)'), null)
    assert.equal(match('Arroz Urbano 7 Grãos 1kg'), null)
    assert.equal(match('Leite Itambé Desnatado Pacote 500g'), null)
    assert.equal(match('Açúcar Mascavo Áster 1kg'), null)
    assert.equal(match('Farinha de Trigo Dona Benta Integral 1kg'), null)
    assert.equal(match('Espaguete de Arroz Urbano 500g'), null)
    assert.equal(match('Ovos de Codorna São José c/ 30'), null)
    assert.equal(match('Detergente Limpol Limão 500ml'), null)
  })
})

// ---- rotas (Postgres de verdade) ---------------------------------------------------------------------

let t: TestEnv
const ze = () => tokenFor(ZE)
const lucia = () => tokenFor(LUCIA)
const maria = () => tokenFor(MARIA)
const ZE_LAT = -3.7371
const ZE_LNG = -38.496

const canonicalId = async (name: string) => (await t.db.query<{ id: number }>('SELECT id FROM canonical_products WHERE name = $1', [name])).rows[0]!.id
const optimizeReq = (body: Record<string, unknown>, token?: string) => t.api('POST', '/api/v1/smart-cart/optimize', { token, body: { lat: ZE_LAT, lng: ZE_LNG, ...body } })

let ARROZ = 0
let CREME_C = 0

before(async () => {
  t = await startTestEnv()
  await seedReferenceData(t.db)
  ARROZ = await canonicalId('Arroz integral 1 kg')
  CREME_C = await canonicalId('Creme de leite 200 g')
})
after(() => t?.stop())

describe('seed e vínculo do catálogo', () => {
  it('seedReferenceData é idempotente e cria receitas', async () => {
    const again = await seedReferenceData(t.db)
    assert.deepEqual(again, { canonicals: 0, recipes: 0 })
    const { rows } = await t.db.query('SELECT count(*)::int AS n FROM recipes')
    assert.equal(rows[0].n, RECIPES.length)
    assert.ok(RECIPES.length >= 50)
  })

  it('linkCatalog vincula só o que casa e relata a taxa', async () => {
    const dry = await linkCatalog(t.db, { dryRun: true })
    const unlinkedBefore = (await t.db.query(`SELECT count(*)::int AS n FROM products WHERE canonical_id IS NOT NULL`)).rows[0].n
    assert.equal(unlinkedBefore, 0, 'dry-run não grava')
    assert.equal(dry.total, 6)
    const r = await linkCatalog(t.db)
    assert.equal(r.byName, 4, 'creme + pão de forma + os dois arrozes integrais')
    assert.equal(r.linked, 4)
    assert.equal(r.rate, 4 / 6)
    const { rows } = await t.db.query(`SELECT id FROM products WHERE canonical_id = $1 ORDER BY id`, [ARROZ])
    assert.deepEqual(rows.map((x) => x.id), [ARROZ_ZE, ARROZ_LUCIA])
    const again = await linkCatalog(t.db)
    assert.equal(again.byName, 0, 'segunda execução não muda nada')
    assert.equal(again.linked, 4)
  })
})

describe('itens canônicos e vínculo pelo lojista', () => {
  it('busca por nome sem diferenciar acento nem caixa, e por apelido', async () => {
    const a = await t.api('GET', '/api/v1/smart-cart/canonicals?q=ACUCAR')
    assert.equal(a.status, 200)
    assert.ok(a.body.some((c: { name: string }) => c.name === 'Açúcar cristal 1 kg'))
    const b = await t.api('GET', '/api/v1/smart-cart/canonicals?q=espaguete')
    assert.deepEqual(b.body.map((c: { name: string }) => c.name), ['Macarrão espaguete 500 g'])
    assert.equal((await t.api('GET', '/api/v1/smart-cart/canonicals')).status, 400)
  })

  it('só o lojista cria item canônico; nome repetido dá 409', async () => {
    const body = { name: 'Iogurte natural 170 g', unitKind: 'UN', aliases: ['iogurte'] }
    assert.equal((await t.api('POST', '/api/v1/smart-cart/canonicals', { body })).status, 401)
    assert.equal((await t.api('POST', '/api/v1/smart-cart/canonicals', { token: maria(), body })).status, 403)
    const ok = await t.api('POST', '/api/v1/smart-cart/canonicals', { token: ze(), body })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.name, 'Iogurte natural 170 g')
    assert.equal((await t.api('POST', '/api/v1/smart-cart/canonicals', { token: ze(), body })).status, 409)
  })

  it('lojista vincula e desvincula só os próprios produtos', async () => {
    const iogurteC = await canonicalId('Iogurte natural 170 g')
    const link = (token: string, productId: string, canonicalId: number | null) => t.api('PUT', `/api/v1/smart-cart/products/${productId}/canonical`, { token, body: { canonicalId } })
    assert.equal((await link(maria(), IOGURTE, iogurteC)).status, 403)
    assert.equal((await link(lucia(), IOGURTE, iogurteC)).status, 404, 'produto de outra loja')
    assert.equal((await link(ze(), IOGURTE, 999_999)).status, 404, 'canônico inexistente')
    assert.equal((await link(ze(), IOGURTE, iogurteC)).status, 204)
    const mine = await t.api('GET', '/api/v1/smart-cart/my-products?linked=true', { token: ze() })
    assert.ok(mine.body.some((p: { id: string; canonicalName: string }) => p.id === IOGURTE && p.canonicalName === 'Iogurte natural 170 g'))
    const free = await t.api('GET', '/api/v1/smart-cart/my-products?linked=false', { token: ze() })
    assert.ok(!free.body.some((p: { id: string }) => p.id === IOGURTE))
    assert.equal((await link(ze(), IOGURTE, null)).status, 204)
  })
})

describe('receitas', () => {
  it('lista receitas públicas e busca por título sem acento', async () => {
    const all = await t.api('GET', '/api/v1/smart-cart/recipes')
    assert.equal(all.status, 200)
    assert.ok(all.body.length >= 5)
    assert.ok(all.body.every((r: { ingredientCount: number }) => r.ingredientCount >= 3))
    const q = await t.api('GET', '/api/v1/smart-cart/recipes?q=macarrao')
    assert.deepEqual(q.body.map((r: { slug: string }) => r.slug), ['macarrao-ao-molho-de-tomate'])
  })

  it('mostra a receita por slug com ingredientes canônicos; 404 se não existe', async () => {
    const r = await t.api('GET', '/api/v1/smart-cart/recipes/strogonoff-de-frango')
    assert.equal(r.status, 200)
    assert.equal(r.body.servings, 4)
    const creme = r.body.ingredients.find((i: { name: string }) => i.name === 'Creme de leite 200 g')
    assert.deepEqual(creme, { canonicalId: CREME_C, name: 'Creme de leite 200 g', quantity: 2, optional: false })
    assert.ok(r.body.ingredients.some((i: { optional: boolean }) => i.optional))
    assert.equal((await t.api('GET', '/api/v1/smart-cart/recipes/nao-existe')).status, 404)
  })

  it('usuário logado cria receita própria (privada não aparece na lista pública)', async () => {
    const body = { slug: 'creme-da-maria', title: 'Creme da Maria', servings: 2, isPublic: false, ingredients: [{ canonicalId: CREME_C, quantity: 1 }] }
    assert.equal((await t.api('POST', '/api/v1/smart-cart/recipes', { body })).status, 401)
    assert.equal((await t.api('POST', '/api/v1/smart-cart/recipes', { token: maria(), body })).status, 201)
    assert.equal((await t.api('POST', '/api/v1/smart-cart/recipes', { token: maria(), body })).status, 409)
    const pub = await t.api('GET', '/api/v1/smart-cart/recipes')
    assert.ok(!pub.body.some((r: { slug: string }) => r.slug === 'creme-da-maria'))
    const mine = await t.api('GET', '/api/v1/smart-cart/recipes/mine', { token: maria() })
    assert.deepEqual(mine.body.map((r: { slug: string }) => r.slug), ['creme-da-maria'])
    assert.equal((await t.api('GET', '/api/v1/smart-cart/recipes/creme-da-maria')).status, 404)
  })
})

describe('listas de compras', () => {
  let listId = ''

  it('exige login', async () => {
    assert.equal((await t.api('GET', '/api/v1/smart-cart/lists')).status, 401)
    assert.equal((await t.api('POST', '/api/v1/smart-cart/lists', { body: { title: 'x', items: [{ freeText: 'pão' }] } })).status, 401)
  })

  it('cria, lê e valida a lista (canônico ou texto livre)', async () => {
    const bad = await t.api('POST', '/api/v1/smart-cart/lists', { token: maria(), body: { title: 'Mês', items: [{ quantity: 2 }] } })
    assert.equal(bad.status, 400)
    const unknown = await t.api('POST', '/api/v1/smart-cart/lists', { token: maria(), body: { title: 'Mês', items: [{ canonicalId: 999_999 }] } })
    assert.equal(unknown.status, 422)
    const res = await t.api('POST', '/api/v1/smart-cart/lists', {
      token: maria(),
      body: { title: 'Compras do mês', items: [{ canonicalId: ARROZ, quantity: 2 }, { freeText: 'pão francês', quantity: 6 }] },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    listId = res.body.id
    assert.equal(res.body.items.length, 2)
    const arroz = res.body.items.find((i: { canonicalId: number | null }) => i.canonicalId === ARROZ)
    assert.equal(arroz.canonicalName, 'Arroz integral 1 kg')
    assert.equal(arroz.quantity, 2)
    assert.equal(res.body.items.find((i: { freeText: string | null }) => i.freeText)?.freeText, 'pão francês')
  })

  it('outra pessoa não vê, não altera e não apaga a lista (404)', async () => {
    assert.equal((await t.api('GET', `/api/v1/smart-cart/lists/${listId}`, { token: lucia() })).status, 404)
    assert.equal((await t.api('PUT', `/api/v1/smart-cart/lists/${listId}`, { token: lucia(), body: { title: 'invadida' } })).status, 404)
    assert.equal((await t.api('POST', `/api/v1/smart-cart/lists/${listId}/items`, { token: lucia(), body: { freeText: 'x' } })).status, 404)
    assert.equal((await t.api('DELETE', `/api/v1/smart-cart/lists/${listId}`, { token: lucia() })).status, 404)
    const mine = await t.api('GET', '/api/v1/smart-cart/lists', { token: lucia() })
    assert.deepEqual(mine.body, [])
  })

  it('dono lista, adiciona e remove itens, renomeia e apaga', async () => {
    const list = await t.api('GET', '/api/v1/smart-cart/lists', { token: maria() })
    assert.equal(list.body.length, 1)
    const add = await t.api('POST', `/api/v1/smart-cart/lists/${listId}/items`, { token: maria(), body: { canonicalId: CREME_C, quantity: 3 } })
    assert.equal(add.status, 201)
    assert.equal(add.body.items.length, 3)
    const item = add.body.items.find((i: { freeText: string | null }) => i.freeText)
    const del = await t.api('DELETE', `/api/v1/smart-cart/lists/${listId}/items/${item.id}`, { token: maria() })
    assert.equal(del.status, 204)
    assert.equal((await t.api('DELETE', `/api/v1/smart-cart/lists/${listId}/items/${item.id}`, { token: maria() })).status, 404)
    const upd = await t.api('PUT', `/api/v1/smart-cart/lists/${listId}`, { token: maria(), body: { title: 'Mês de novembro' } })
    assert.equal(upd.body.title, 'Mês de novembro')
    assert.equal(upd.body.items.length, 2, 'só o título mudou')
    const swap = await t.api('PUT', `/api/v1/smart-cart/lists/${listId}`, { token: maria(), body: { items: [{ canonicalId: CREME_C, quantity: 1 }] } })
    assert.deepEqual(swap.body.items.map((i: { canonicalId: number }) => i.canonicalId), [CREME_C])
    assert.equal((await t.api('PUT', `/api/v1/smart-cart/lists/${listId}`, { token: maria(), body: {} })).status, 400)
    const empty = await t.api('POST', '/api/v1/smart-cart/lists', { token: maria(), body: { title: 'Vazia', items: [] } })
    assert.equal(empty.status, 201, 'a lista pode nascer vazia')
    assert.deepEqual(empty.body.items, [])
    assert.equal((await optimizeReq({ listId: empty.body.id }, maria())).status, 422, 'nada para comparar')
    assert.equal((await t.api('DELETE', `/api/v1/smart-cart/lists/${empty.body.id}`, { token: maria() })).status, 204)
    assert.equal((await t.api('DELETE', `/api/v1/smart-cart/lists/${listId}`, { token: maria() })).status, 204)
    assert.equal((await t.api('GET', `/api/v1/smart-cart/lists/${listId}`, { token: maria() })).status, 404)
  })

  it('cria lista a partir de receita, escalando as porções e deixando o opcional de fora', async () => {
    const res = await t.api('POST', '/api/v1/smart-cart/lists/from-recipe', { token: maria(), body: { recipeSlug: 'strogonoff-de-frango', servings: 8 } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.match(res.body.title, /Strogonoff de frango/)
    assert.ok(res.body.sourceRecipeId)
    const byName = Object.fromEntries(res.body.items.map((i: { canonicalName: string; quantity: number }) => [i.canonicalName, i.quantity]))
    assert.equal(byName['Creme de leite 200 g'], 4, '2 un. para 4 porções → 4 un. para 8')
    assert.equal(byName['Filé de peito de frango 1 kg'], 2)
    assert.equal(byName['Cebola (kg)'], 0.4)
    assert.ok(!('Sal refinado 1 kg' in byName), '"a gosto" fica de fora')
    assert.equal((await t.api('POST', '/api/v1/smart-cart/lists/from-recipe', { token: maria(), body: { recipeSlug: 'nao-existe' } })).status, 404)
  })
})

describe('otimizar: POST /smart-cart/optimize', () => {
  it('valida o corpo: exatamente uma fonte, coordenadas obrigatórias', async () => {
    assert.equal((await optimizeReq({})).status, 400)
    assert.equal((await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 1 }], recipeSlug: 'bolo-de-cenoura' })).status, 400)
    assert.equal((await t.api('POST', '/api/v1/smart-cart/optimize', { body: { items: [{ canonicalId: ARROZ, quantity: 1 }] } })).status, 400)
    assert.equal((await optimizeReq({ items: [{ canonicalId: 999_999, quantity: 1 }] })).status, 422)
    assert.equal((await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 150 }] })).status, 422)
  })

  it('sem frete: plano numa loja só (cobertura primeiro) e plano dividido cobrindo tudo', async () => {
    const res = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 2 }, { canonicalId: CREME_C, quantity: 3 }] })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const { single, split, missing } = res.body
    // Zé só tem o creme (arroz esgotado); Lúcia só tem o arroz. Nenhuma loja cobre os dois.
    assert.equal(single.stores.length, 1)
    assert.equal(single.stores[0].storeName, 'Mercadinho do Zé')
    assert.deepEqual(single.missing, [ARROZ])
    assert.equal(single.total, 12.87)
    assert.equal(split.stores.length, 2)
    assert.deepEqual(split.missing, [])
    assert.equal(split.itemsTotal, 27.27)
    assert.equal(split.total, 27.27)
    assert.deepEqual(missing, [])
    assert.equal(res.body.storesConsidered, 2)
    const lucia = split.stores.find((s: { storeName: string }) => s.storeName === 'Mercadinho da Dona Lúcia')
    assert.deepEqual(lucia.lines, [{ canonicalId: ARROZ, productId: ARROZ_LUCIA, productName: 'Arroz Camil Integral 1kg', quantity: 2, unitPrice: 7.2, subtotal: 14.4 }])
    assert.equal(lucia.deliveryFee, 0)
    assert.equal(lucia.deliveryEnabled, false)
    assert.ok(lucia.distanceM > 300 && lucia.distanceM < 700)
  })

  it('raio: loja fora do alcance não entra; item sem oferta vai para "missing"', async () => {
    const res = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 1 }, { canonicalId: CREME_C, quantity: 1 }], radiusM: 300 })
    assert.equal(res.body.storesConsidered, 1)
    assert.deepEqual(res.body.missing, [{ canonicalId: ARROZ, name: 'Arroz integral 1 kg' }])
    assert.equal(res.body.split.stores.length, 1)
    const none = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 1 }], lat: -3.9, lng: -38.7 })
    assert.equal(none.status, 200)
    assert.equal(none.body.single, null)
    assert.equal(none.body.split, null)
    assert.equal(none.body.savings, 0)
    assert.equal(none.body.missing.length, 1)
  })

  it('Salva-Estoque: usa o preço efetivo com desconto da validade', async () => {
    const iogC = await t.api('POST', '/api/v1/smart-cart/canonicals', { token: ze(), body: { name: 'Iogurte de morango 170 g' } })
    assert.equal((await t.api('PUT', `/api/v1/smart-cart/products/${IOGURTE}/canonical`, { token: ze(), body: { canonicalId: iogC.body.id } })).status, 204)
    const res = await optimizeReq({ items: [{ canonicalId: iogC.body.id, quantity: 2 }] })
    assert.equal(res.body.single.stores[0].lines[0].unitPrice, 2.72, 'R$ 3,89 com 30% OFF')
    assert.equal(res.body.single.total, 5.44)
  })

  it('frete por loja entra na conta e pode fazer a loja única vencer; frete só na distância atendida', async () => {
    await t.db.query(
      `INSERT INTO store_delivery_config (merchant_id, delivery_enabled, delivery_radius_m, delivery_fee) VALUES ($1, TRUE, 3000, 5.00), ($2, TRUE, 3000, 4.00)
       ON CONFLICT (merchant_id) DO UPDATE SET delivery_enabled = TRUE, delivery_fee = EXCLUDED.delivery_fee`,
      [ZE, LUCIA],
    )
    const res = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 2 }, { canonicalId: CREME_C, quantity: 3 }] })
    assert.equal(res.body.split.feesTotal, 9)
    assert.equal(res.body.split.total, 36.27)
    assert.equal(res.body.single.feesTotal, 5)
    assert.equal(res.body.single.total, 17.87)
    assert.deepEqual(res.body.single.stores.map((s: { deliveryFee: number; deliveryEnabled: boolean }) => [s.deliveryFee, s.deliveryEnabled]), [[5, true]])
    // Cliente a ~5 km (fora do raio de entrega de 3 km) → retirada, sem taxa.
    const pickup = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 1 }], lat: ZE_LAT - 0.045, radiusM: 10_000 })
    assert.equal(pickup.body.single.feesTotal, 0)
    assert.equal(pickup.body.single.stores[0].deliveryEnabled, false)
    await t.db.query(`DELETE FROM store_delivery_config`)
  })

  it('oferta relâmpago ativa vence se for mais barata e tiver saldo para a quantidade', async () => {
    const created = await t.api('POST', '/api/v1/flash', { token: lucia(), body: { productId: ARROZ_LUCIA, offerPrice: 6, qtyTotal: 10, maxPerCustomer: 2, durationMin: 60 } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const two = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 2 }] })
    const line = two.body.single.stores[0].lines[0]
    assert.equal(line.unitPrice, 6)
    assert.equal(line.productId, ARROZ_LUCIA)
    assert.equal(line.flash.id, created.body.id)
    assert.equal(line.flash.maxPerCustomer, 2)
    assert.equal(line.flash.originalPrice, 7.2)
    assert.equal(two.body.single.total, 12)
    // Passou do máximo por cliente: volta ao preço normal da prateleira.
    const three = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 3 }] })
    assert.equal(three.body.single.stores[0].lines[0].unitPrice, 7.2)
    assert.equal(three.body.single.stores[0].lines[0].flash, undefined)
    // Oferta cancelada: não conta mais.
    await t.api('POST', `/api/v1/flash/${created.body.id}/cancel`, { token: lucia() })
    const after = await optimizeReq({ items: [{ canonicalId: ARROZ, quantity: 2 }] })
    assert.equal(after.body.single.stores[0].lines[0].unitPrice, 7.2)
  })

  it('otimiza uma receita (porções escaladas, opcionais fora) e lista com itens em texto livre', async () => {
    const res = await optimizeReq({ recipeSlug: 'strogonoff-de-frango', servings: 8 })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const creme = res.body.split.stores[0].lines.find((l: { canonicalId: number }) => l.canonicalId === CREME_C)
    assert.equal(creme.quantity, 4)
    assert.equal(creme.subtotal, 17.16)
    const names = res.body.missing.map((m: { name: string }) => m.name)
    assert.ok(names.includes('Filé de peito de frango 1 kg') && !names.includes('Sal refinado 1 kg'))
    assert.equal((await optimizeReq({ recipeSlug: 'nao-existe' })).status, 404)

    const list = await t.api('POST', '/api/v1/smart-cart/lists', {
      token: maria(),
      body: { title: 'Teste', items: [{ canonicalId: CREME_C, quantity: 2 }, { freeText: 'pão francês', quantity: 6 }] },
    })
    assert.equal((await optimizeReq({ listId: list.body.id })).status, 401, 'lista exige login')
    assert.equal((await optimizeReq({ listId: list.body.id }, lucia())).status, 404, 'lista de outra pessoa')
    const mine = await optimizeReq({ listId: list.body.id }, maria())
    assert.equal(mine.status, 200)
    assert.deepEqual(mine.body.unclassified, ['pão francês'])
    assert.equal(mine.body.single.total, 8.58)
  })

  it('arredonda quantidade fracionada para unidades inteiras', async () => {
    const cebola = await canonicalId('Cebola (kg)')
    await t.db.query(`UPDATE products SET canonical_id = $1 WHERE id = $2`, [cebola, CREME]) // reaproveita um produto do seed como "cebola"
    const res = await optimizeReq({ items: [{ canonicalId: cebola, quantity: 0.3 }] })
    assert.equal(res.body.single.stores[0].lines[0].quantity, 1)
    await t.db.query(`UPDATE products SET canonical_id = $1 WHERE id = $2`, [CREME_C, CREME])
  })

  it('economia: split nunca custa mais que single; mostra a diferença', async () => {
    const res = await optimizeReq({ items: [{ canonicalId: CREME_C, quantity: 2 }] })
    assert.equal(res.body.savings, 0)
    assert.ok(res.body.split.total <= res.body.single.total)
  })
})

describe('otimizar com Clube VIP: bate com o POST /orders', () => {
  const NEAR = { deliveryLat: -3.74, deliveryLng: -38.495 }
  const WEBHOOK_SECRET = 'dev-vip-webhook-secret'

  async function vipCustomer() {
    const { rows } = await t.db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Cliente VIP SC', $1, 'x', 'CUSTOMER') RETURNING id`, [`sc-vip-${Math.random().toString(36).slice(2)}@vizinhohub.test`])
    const token = tokenFor(rows[0].id as string)
    const planId = (await t.db.query(`SELECT id FROM vip_plans WHERE code = 'vizinho-vip'`)).rows[0].id
    const sub = await t.api('POST', '/api/vip/subscribe', { token, body: { planId } })
    assert.equal(sub.status, 201, JSON.stringify(sub.body))
    const hook = await fetch(`${t.baseUrl}/api/vip/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vip-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify({ eventId: `evt-${Math.random().toString(36).slice(2)}`, kind: 'PAYMENT_PAID', paymentRef: sub.body.pendingInvoice.providerRef }),
    })
    assert.equal(hook.status, 200)
    return token
  }

  it('mesmo total e mesmo frete que o pedido cobra; sem login nada muda', async () => {
    await t.db.query(
      `INSERT INTO store_delivery_config (merchant_id, delivery_enabled, delivery_radius_m, delivery_fee) VALUES ($1, TRUE, 3000, 6.50)
       ON CONFLICT (merchant_id) DO UPDATE SET delivery_enabled = TRUE, delivery_radius_m = 3000, delivery_fee = 6.50`,
      [ZE],
    )
    await t.db.query(
      `INSERT INTO vip_merchants (merchant_id, discount_enabled, discount_cap_pct, funds_free_delivery) VALUES ($1, TRUE, 10, TRUE)
       ON CONFLICT (merchant_id) DO UPDATE SET discount_enabled = TRUE, discount_cap_pct = 10, funds_free_delivery = TRUE`,
      [ZE],
    )
    try {
      const token = await vipCustomer()
      for (const quantity of [1, 8]) {
        const plan = (await optimizeReq({ items: [{ canonicalId: CREME_C, quantity }] }, token)).body.single
        const orderRes = await t.api('POST', '/api/orders', {
          token,
          body: { items: [{ productId: CREME, quantity }], fulfillment: 'DELIVERY', deliveryAddress: 'Rua A, 100', ...NEAR },
        })
        assert.equal(orderRes.status, 201, JSON.stringify(orderRes.body))
        const fee = Number((await t.db.query('SELECT delivery_fee FROM orders WHERE id = $1', [orderRes.body.id])).rows[0].delivery_fee)
        const st = plan.stores[0]
        assert.equal(plan.itemsTotal, orderRes.body.totalPrice, `itens x ${quantity}`)
        assert.equal(st.deliveryFee, fee, `frete x ${quantity}`)
        assert.equal(plan.total, Math.round((orderRes.body.totalPrice + fee) * 100) / 100)
        assert.equal(st.vipDiscountPct, 2)
        assert.equal(st.vipSavings, orderRes.body.vipSavings)
        assert.equal(plan.vipSavings, orderRes.body.vipSavings)
        assert.equal(st.vipFreeDelivery, quantity === 8, 'grátis só acima do mínimo (R$ 30)')
        assert.equal(st.originalDeliveryFee, quantity === 8 ? 6.5 : undefined)
      }
      // Sem token: preço cheio e taxa normal.
      const anon = (await optimizeReq({ items: [{ canonicalId: CREME_C, quantity: 8 }] })).body.single
      assert.equal(anon.itemsTotal, 34.32)
      assert.equal(anon.feesTotal, 6.5)
      assert.equal(anon.stores[0].vipSavings, 0)
      assert.equal(anon.stores[0].vipFreeDelivery, false)
    } finally {
      await t.db.query(`DELETE FROM vip_merchants WHERE merchant_id = $1`, [ZE])
      await t.db.query(`DELETE FROM store_delivery_config`)
    }
  })
})
