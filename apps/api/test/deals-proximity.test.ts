// Etapa 11.2: filial mais próxima nas ofertas (?lat=&lng=), lista de filiais da rede e envio de encarte já estruturado.
// O roteador é falso (sem rede): cada teste define o tempo de cada filial pela latitude e conta as chamadas.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { LatLng, RouteResult, Router } from '../src/modules/branches/routing.js'
import { AT_BRANCH_RADIUS_M } from '../src/modules/branches/branches.service.js'
import { LUCIA, MARIA, startTestEnv, tokenFor, ZE, type TestEnv } from './helpers.js'

// ---- roteador falso -----------------------------------------------------------------------------------------
const routerCalls: Array<{ origin: LatLng; dests: LatLng[] }> = []
const durations = new Map<number, number>() // latitude da filial -> segundos
const fakeRouter: Router = {
  async route(origin, dests): Promise<RouteResult[]> {
    routerCalls.push({ origin, dests })
    // Frações de propósito: o serviço precisa arredondar.
    return dests.map((d) => ({ distanceM: (durations.get(d.lat) ?? 600) * 10 + 0.4, durationS: (durations.get(d.lat) ?? 600) + 0.6, estimated: false }))
  },
}

let t: TestEnv
before(async () => {
  t = await startTestEnv(0, { router: fakeRouter })
})
after(() => t?.stop())

const ORIGIN = { lat: -3.74, lng: -38.52 }
const chainId = async (slug: string): Promise<number> => (await t.db.query('SELECT id FROM retail_chains WHERE slug = $1', [slug])).rows[0].id

async function addBranch(slug: string, name: string, hood: string | null, lat: number, lng: number, active = true, ref?: string): Promise<number> {
  const { rows } = await t.db.query(
    `INSERT INTO chain_branches (chain_id, name, neighborhood, latitude, longitude, active, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [await chainId(slug), name, hood, lat, lng, active, ref ?? name],
  )
  return rows[0].id
}

async function addDeal(slug: string, sourceId: number, name: string, hood: string | null): Promise<string> {
  const { rows } = await t.db.query(
    `INSERT INTO deals (chain_id, source_id, neighborhood, product_name, category, unit, original_price, discount_price, discount_pct, coupon_eligible)
     VALUES ($1, $2, $3, $4, 'Mercearia', 'un', 10, 5, 50, TRUE) RETURNING id`,
    [await chainId(slug), sourceId, hood, name],
  )
  return rows[0].id
}
const addSource = async (slug: string): Promise<number> =>
  (await t.db.query(`INSERT INTO deal_sources (chain_id, url) VALUES ($1, $2) RETURNING id`, [await chainId(slug), `https://exemplo.test/${slug}`])).rows[0].id

const q = (c: LatLng) => `lat=${c.lat}&lng=${c.lng}`
const dealsOf = async (qs: string) => (await t.api('GET', `/api/v1/deals?${qs}`)).body as Array<Record<string, any>>
const byName = (list: Array<Record<string, any>>, name: string) => list.find((d) => d.productName === name)!

describe('filial mais próxima nas ofertas', () => {
  const ids: Record<string, number> = {}
  const dealIds: Record<string, string> = {}

  before(async () => {
    // São Luiz: A (667 m) é a mais perto em linha reta, mas lenta; B (1,1 km) é a mais rápida; C é a terceira; D fica de fora.
    ids.A = await addBranch('sao-luiz', 'São Luiz Aldeota', 'Aldeota', -3.734, -38.52)
    ids.B = await addBranch('sao-luiz', 'São Luiz Meireles', 'Meireles', -3.75, -38.52)
    ids.C = await addBranch('sao-luiz', 'São Luiz Centro', 'Centro', -3.78, -38.52)
    ids.D = await addBranch('sao-luiz', 'São Luiz Messejana', 'Messejana', -3.83, -38.52)
    await addBranch('sao-luiz', 'São Luiz Fechada', 'Aldeota', -3.7401, -38.52, false) // a mais perto de todas, mas inativa
    durations.set(-3.734, 900)
    durations.set(-3.75, 300)
    durations.set(-3.78, 700)
    durations.set(-3.83, 1)

    // Cometa: duas filiais em bairros diferentes; a do bairro da oferta vale mesmo sendo a mais lenta.
    ids.cometaAldeota = await addBranch('cometa', 'Cometa Aldeota', 'Aldeota', -3.734, -38.52)
    ids.cometaParq = await addBranch('cometa', 'Cometa Parquelândia', 'Parquelândia', -3.755, -38.52)

    const sl = await addSource('sao-luiz')
    dealIds.arroz = await addDeal('sao-luiz', sl, 'Arroz Prox 1kg', null)
    await addDeal('sao-luiz', sl, 'Feijão Prox 1kg', null)
    await addDeal('sao-luiz', sl, 'Açúcar Prox 1kg', null)
    const cm = await addSource('cometa')
    dealIds.parq = await addDeal('cometa', cm, 'Café Parq 500g', 'parquelandia') // sem acento nem caixa
    await addDeal('cometa', cm, 'Leite Aldeota 1L', 'ALDEOTA')
    await addDeal('cometa', cm, 'Óleo Sem Filial 900ml', 'Bairro Inexistente') // sem filial no bairro: vale a rede toda
    const pn = await addSource('pinheiro')
    dealIds.pinheiro = await addDeal('pinheiro', pn, 'Sal Pinheiro 1kg', null)
  })

  it('a filial de menor tempo de rota ganha, mesmo não sendo a mais perto em linha reta', async () => {
    routerCalls.length = 0
    const res = await t.api('GET', `/api/v1/deals/${dealIds.arroz}?${q(ORIGIN)}`)
    assert.equal(res.status, 200)
    const nb = res.body.nearestBranch
    assert.equal(nb.id, ids.B)
    assert.equal(nb.name, 'São Luiz Meireles')
    assert.equal(nb.neighborhood, 'Meireles')
    assert.equal(nb.latitude, -3.75)
    assert.equal(nb.longitude, -38.52)
    assert.equal(nb.durationS, 301) // 300,6 arredondado
    assert.equal(nb.distanceM, 3000) // 3000,4 arredondado
    assert.equal(nb.estimated, false)
    assert.equal(nb.atBranch, false)
    // Uma chamada, só com as 3 mais perto em linha reta (A, B, C): a quarta (D) e a inativa ficam de fora.
    assert.equal(routerCalls.length, 1)
    assert.deepEqual(routerCalls[0]!.dests.map((d) => d.lat), [-3.734, -3.75, -3.78])
    assert.deepEqual(routerCalls[0]!.origin, ORIGIN)
  })

  it('restringe às filiais do bairro da oferta (sem acento nem caixa); sem filial no bairro vale a rede toda', async () => {
    durations.set(-3.734, 100) // a do Aldeota é bem mais rápida...
    durations.set(-3.755, 800)
    routerCalls.length = 0
    const list = await dealsOf(`chain=cometa&${q(ORIGIN)}`)
    // ...mas a oferta do Parquelândia vale só naquela loja.
    const parq = byName(list, 'Café Parq 500g').nearestBranch
    assert.equal(parq.id, ids.cometaParq)
    assert.equal(byName(list, 'Leite Aldeota 1L').nearestBranch.id, ids.cometaAldeota)
    // Bairro sem filial cadastrada: cai para as filiais da rede, e vence a mais rápida.
    assert.equal(byName(list, 'Óleo Sem Filial 900ml').nearestBranch.id, ids.cometaAldeota)
    assert.equal(routerCalls.length, 3) // um por (rede, bairro): parquelandia, aldeota, inexistente
    assert.ok(routerCalls.some((c) => c.dests.length === 1 && c.dests[0]!.lat === -3.755)) // só a filial do bairro foi consultada
    durations.set(-3.734, 900)
    durations.set(-3.755, 600)
  })

  it('atBranch: a 20 m da filial já está na loja (tempo 0, sem consultar a rota); a 200 m não', async () => {
    assert.ok(AT_BRANCH_RADIUS_M > 20 && AT_BRANCH_RADIUS_M < 200, `raio=${AT_BRANCH_RADIUS_M}`) // padrão 50 m: GPS de celular erra de 5 a 30 m
    routerCalls.length = 0
    const near = { lat: -3.734 + 20 / 111_195, lng: -38.52 }
    const here = (await t.api('GET', `/api/v1/deals/${dealIds.arroz}?${q(near)}`)).body.nearestBranch
    assert.equal(here.id, ids.A)
    assert.equal(here.atBranch, true)
    assert.equal(here.durationS, 0)
    assert.ok(Math.abs(here.distanceM - 20) <= 1, `distanceM=${here.distanceM}`)
    assert.equal(here.estimated, false)
    assert.equal(routerCalls.length, 0)

    const far = { lat: -3.734 + 200 / 111_195, lng: -38.52 }
    const away = (await t.api('GET', `/api/v1/deals/${dealIds.arroz}?${q(far)}`)).body.nearestBranch
    assert.equal(away.atBranch, false)
    assert.ok(away.durationS > 0)
    assert.equal(routerCalls.length, 1)
  })

  it('rede sem filiais cadastradas: nearestBranch null', async () => {
    const res = await t.api('GET', `/api/v1/deals/${dealIds.pinheiro}?${q(ORIGIN)}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.nearestBranch, null)
  })

  it('sem coordenadas o campo vem null, na lista e no detalhe, e nada é roteado', async () => {
    routerCalls.length = 0
    const list = await dealsOf('chain=sao-luiz')
    assert.ok(list.length >= 3)
    for (const d of list) assert.ok('nearestBranch' in d && d.nearestBranch === null)
    assert.equal((await t.api('GET', `/api/v1/deals/${dealIds.arroz}`)).body.nearestBranch, null)
    assert.equal(routerCalls.length, 0)
  })

  it('lat sem lng (ou o contrário) e valores fora da faixa dão 400', async () => {
    for (const qs of ['lat=-3.7', 'lng=-38.5', 'lat=91&lng=-38.5', 'lat=-3.7&lng=181', 'lat=abc&lng=-38.5', 'lat=&lng=-38.5', 'lat=-3.7&lng=']) {
      const res = await t.api('GET', `/api/v1/deals?${qs}`)
      assert.equal(res.status, 400, qs)
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', qs)
      const one = await t.api('GET', `/api/v1/deals/${dealIds.arroz}?${qs}`)
      assert.equal(one.status, 400, qs)
    }
  })

  it('uma chamada ao roteador por rede, mesmo com várias ofertas', async () => {
    routerCalls.length = 0
    const list = await dealsOf(`chain=sao-luiz&${q(ORIGIN)}`)
    assert.equal(list.filter((d) => d.chain.slug === 'sao-luiz').length, 3)
    for (const d of list) assert.equal(d.nearestBranch.id, ids.B)
    assert.equal(routerCalls.length, 1)

    // Sem filtro de rede: uma chamada por rede com filial e por bairro de oferta (São Luiz 1 + Cometa 3); Pinheiro não tem filial.
    routerCalls.length = 0
    await dealsOf(q(ORIGIN))
    assert.equal(routerCalls.length, 4)
  })

  it('não altera a ordenação nem os filtros: a lista com coordenadas é a mesma sem elas', async () => {
    const plain = (await dealsOf('chain=cometa')).map((d) => d.id)
    const located = (await dealsOf(`chain=cometa&${q(ORIGIN)}`)).map((d) => d.id)
    assert.deepEqual(located, plain)
  })

  describe('GET /deals/chains/:slug/branches', () => {
    it('lista só as filiais ativas, com os campos públicos', async () => {
      const res = await t.api('GET', '/api/v1/deals/chains/sao-luiz/branches')
      assert.equal(res.status, 200)
      assert.deepEqual(res.body.map((b: { name: string }) => b.name).sort(), ['São Luiz Aldeota', 'São Luiz Centro', 'São Luiz Meireles', 'São Luiz Messejana'])
      assert.deepEqual(Object.keys(res.body[0]).sort(), ['address', 'id', 'latitude', 'longitude', 'name', 'neighborhood'])
      assert.equal(typeof res.body[0].latitude, 'number')
    })

    it('rede existente sem filiais: lista vazia; rede inexistente: 404', async () => {
      assert.deepEqual((await t.api('GET', '/api/v1/deals/chains/pinheiro/branches')).body, [])
      const missing = await t.api('GET', '/api/v1/deals/chains/nao-existe/branches')
      assert.equal(missing.status, 404)
      assert.equal(missing.body.error.code, 'CHAIN_NOT_FOUND')
    })
  })
})

describe('POST /deals/flyers/structured', () => {
  const lucia = () => tokenFor(LUCIA)
  const post = (body: unknown, token: string | null = lucia()) => t.api('POST', '/api/v1/deals/flyers/structured', { token: token ?? undefined, body })
  const item = (over: Record<string, unknown> = {}) => ({
    productName: 'Leite Estruturado 1L',
    category: 'Laticínios e Ovos',
    unit: 'l',
    originalPrice: 6.99,
    discountPrice: 4.79,
    ...over,
  })
  const live = async (hood?: string) =>
    (await dealsOf(`chain=sao-luiz&search=estruturado${hood ? `&neighborhood=${encodeURIComponent(hood)}` : ''}&limit=200`)).map((d) => d.productName).sort()

  before(async () => {
    await t.db.query("INSERT INTO retail_chain_managers (chain_id, user_id) SELECT id, $1 FROM retail_chains WHERE slug = 'sao-luiz'", [LUCIA])
  })

  it('exige login, papel de comerciante, rede existente e gerente da rede', async () => {
    assert.equal((await post({ chain: 'sao-luiz', deals: [item()] }, null)).status, 401)
    assert.equal((await post({ chain: 'sao-luiz', deals: [item()] }, tokenFor(MARIA))).status, 403) // cliente
    const notManager = await post({ chain: 'sao-luiz', deals: [item()] }, tokenFor(ZE)) // comerciante de outra loja
    assert.equal(notManager.status, 403)
    assert.equal(notManager.body.error.code, 'NOT_CHAIN_MANAGER')
    const missing = await post({ chain: 'nao-existe', deals: [item()] })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'CHAIN_NOT_FOUND')
    assert.deepEqual(await live(), []) // nada foi gravado
  })

  it('corpo inválido dá 400', async () => {
    assert.equal((await post({ deals: [item()] })).status, 400) // sem chain
    assert.equal((await post({ chain: 'sao-luiz' })).status, 400) // sem deals
    assert.equal((await post({ chain: 'sao-luiz', deals: [] })).status, 400)
    assert.equal((await post({ chain: 'sao-luiz', deals: 'x' })).status, 400)
    assert.equal((await post({ chain: 'sao-luiz', validDays: 99, deals: [item()] })).status, 400)
    assert.equal((await post({ chain: 'sao-luiz', deals: Array.from({ length: 201 }, (_, i) => item({ productName: `Produto ${i}` })) })).status, 400)
    const raw = await fetch(`${t.baseUrl}/api/v1/deals/flyers/structured`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${lucia()}` },
      body: '{"chain": ',
    })
    assert.equal(raw.status, 400) // JSON malformado
  })

  it('201: grava as ofertas (síncrono, sem chave do modelo) e elas aparecem em GET /deals', async () => {
    const res = await post({
      chain: 'sao-luiz',
      neighborhood: 'Parquelândia',
      validDays: 3,
      fileName: 'encarte-lido-pelo-claude.png',
      deals: [item(), item({ productName: 'Arroz Estruturado 1kg', category: 'Mercearia', unit: 'kg', originalPrice: null, discountPrice: 5.5, wholesaleMinQty: 3, isFlashDeal: true })],
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'SUCCESS')
    assert.equal(res.body.itemsExtracted, 2)
    assert.equal(res.body.itemsDropped, 0)
    assert.equal('dropped' in res.body, false)
    assert.equal(res.body.mediaType, 'application/json')
    assert.equal(res.body.fileName, 'encarte-lido-pelo-claude.png')
    assert.equal(res.body.neighborhood, 'Parquelândia')
    assert.equal(res.body.chain.slug, 'sao-luiz')
    assert.ok(res.body.finishedAt)

    const list = await dealsOf('chain=sao-luiz&search=estruturado')
    assert.deepEqual(list.map((d) => d.productName).sort(), ['Arroz Estruturado 1kg', 'Leite Estruturado 1L'])
    const leite = byName(list, 'Leite Estruturado 1L')
    assert.equal(leite.discountPct, 31) // recalculado, como no extrator
    assert.equal(leite.couponEligible, true)
    assert.equal(leite.neighborhood, 'Parquelândia')
    const arroz = byName(list, 'Arroz Estruturado 1kg')
    assert.equal(arroz.discountPct, null)
    assert.equal(arroz.couponEligible, false)
    assert.equal(arroz.wholesaleMinQty, 3)
    assert.equal(arroz.isFlashDeal, true)

    const validUntil = (await t.db.query("SELECT valid_until FROM deals WHERE product_name = 'Leite Estruturado 1L'")).rows[0].valid_until as Date
    assert.ok(Math.abs((validUntil.getTime() - Date.now()) / 86_400_000 - 3) < 0.01)
    assert.equal((await t.db.query("SELECT url FROM deal_sources WHERE url LIKE 'flyer:sao-luiz:%'")).rows[0].url, 'flyer:sao-luiz:parquelândia')

    const mine = await t.api('GET', '/api/v1/deals/flyers', { token: lucia() })
    assert.equal(mine.body[0].id, res.body.id) // fica no histórico de envios
  })

  it('oferta ruim é descartada com o motivo, sem derrubar as boas', async () => {
    const res = await post({
      chain: 'sao-luiz',
      neighborhood: 'Descarte',
      deals: [
        item({ productName: 'Boa Estruturado 1L' }),
        item({ productName: 'Sem preço Estruturado', discountPrice: undefined }), // 1
        item({ productName: 'Categoria Estruturado', category: 'Eletrônicos' }), // 2
        item({ productName: 'Absurdo Estruturado', discountPrice: 0.1 }), // 3: ~99% de desconto
        item({ productName: 'Mais cara Estruturado', discountPrice: 7 }), // 4: "por" maior que "de"
        item({ productName: 'Boa Estruturado 1L', discountPrice: 4.5 }), // 5: repetida, mais barata -> a de índice 0 sai
        'não sou uma oferta', // 6
      ],
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.itemsExtracted, 1)
    assert.equal(res.body.itemsDropped, 6)
    const dropped = res.body.dropped as Array<{ index: number; productName: string | null; reason: string }>
    assert.deepEqual(dropped.map((d) => d.index), [0, 1, 2, 3, 4, 6])
    const reason = (i: number) => dropped.find((d) => d.index === i)!
    assert.match(reason(0).reason, /repetida/i)
    assert.match(reason(1).reason, /discountPrice/)
    assert.equal(reason(1).productName, 'Sem preço Estruturado')
    assert.match(reason(2).reason, /category/)
    assert.match(reason(3).reason, /erro de leitura/)
    assert.match(reason(4).reason, /não é menor/)
    assert.equal(reason(6).productName, null)
    for (const d of dropped) assert.ok(d.reason.length > 0)
    assert.deepEqual(await live('Descarte'), ['Boa Estruturado 1L'])
    assert.equal((await dealsOf('chain=sao-luiz&search=Boa%20Estruturado&neighborhood=Descarte'))[0]!.discountPrice, 4.5) // ficou a de menor preço
  })

  it('todas as ofertas ruins: 422 com os motivos, e nada é gravado', async () => {
    const before = (await t.db.query('SELECT count(*)::int AS n FROM flyer_uploads')).rows[0].n
    const res = await post({ chain: 'sao-luiz', neighborhood: 'Tudo Ruim', deals: [item({ discountPrice: 9 }), item({ category: 'X' }), { lixo: true }] })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'NO_VALID_DEALS')
    assert.equal(res.body.error.details.dropped.length, 3)
    assert.deepEqual(res.body.error.details.dropped.map((d: { index: number }) => d.index), [0, 1, 2])
    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM flyer_uploads')).rows[0].n, before)
    assert.deepEqual(await live('Tudo Ruim'), [])
  })

  it('append=false (padrão) desativa as ofertas antigas da rede+bairro; append=true mantém', async () => {
    const send = (names: string[], append?: boolean, hood = 'Montese') =>
      post({ chain: 'sao-luiz', neighborhood: hood, ...(append !== undefined && { append }), deals: names.map((productName) => item({ productName })) })

    assert.equal((await send(['Um Estruturado', 'Dois Estruturado'])).status, 201)
    assert.deepEqual(await live('Montese'), ['Dois Estruturado', 'Um Estruturado'])

    // Mesmo bairro, sem append: o encarte novo substitui o anterior.
    assert.equal((await send(['Tres Estruturado'], false)).status, 201)
    assert.deepEqual(await live('Montese'), ['Tres Estruturado'])

    // append=true: acrescenta (encarte de várias páginas).
    assert.equal((await send(['Quatro Estruturado'], true)).status, 201)
    assert.deepEqual(await live('Montese'), ['Quatro Estruturado', 'Tres Estruturado'])

    // Outro bairro é outra fonte: não mexe nas ofertas de Montese.
    assert.equal((await send(['Cinco Estruturado'], false, 'Benfica')).status, 201)
    assert.deepEqual(await live('Montese'), ['Quatro Estruturado', 'Tres Estruturado'])
    assert.equal((await t.db.query("SELECT count(*)::int AS n FROM deals WHERE product_name = 'Um Estruturado' AND active")).rows[0].n, 0)
  })

  it('aceita corpo de mais de 100 KB (parser próprio de 1 MB) com 200 ofertas', async () => {
    const deals = Array.from({ length: 200 }, (_, i) => item({ productName: `Lote Estruturado ${i}`, rawOfferText: 'x'.repeat(500) }))
    assert.ok(JSON.stringify(deals).length > 100 * 1024)
    const res = await post({ chain: 'sao-luiz', neighborhood: 'Lote', deals })
    assert.equal(res.status, 201)
    assert.equal(res.body.itemsExtracted, 200)
  })
})
