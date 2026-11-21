import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { parseExtraction } from '../src/modules/deals/deals.extractor.js'
import { htmlToText, robotsAllows } from '../src/modules/deals/deals.fetcher.js'
import { runDealsScan } from '../src/modules/deals/deals.scanner.js'
import type { ExtractedDeal, ExtractionResult } from '../src/modules/deals/deals.types.js'
import type { ExtractionInput } from '../src/modules/deals/deals.extractor.js'
import { LUCIA, MARIA, startTestEnv, tokenFor, ZE, type TestEnv } from './helpers.js'

let t: TestEnv
// Extrator falso dos testes de upload de encarte (o scanner injeta o seu próprio).
let flyerExtract: (input: ExtractionInput) => Promise<ExtractionResult> = async () => result()
const flyerCalls: ExtractionInput[] = []
before(async () => {
  t = await startTestEnv(0, {
    extractor: async (input) => {
      flyerCalls.push(input)
      return flyerExtract(input)
    },
  })
})
after(() => t?.stop())

const deal = (over: Partial<ExtractedDeal> = {}): ExtractedDeal => ({
  productName: 'Leite Integral Betânia 1L',
  category: 'Laticínios e Ovos',
  brand: 'Betânia',
  unit: 'l',
  wholesaleMinQty: 1,
  originalPrice: 6.99,
  discountPrice: 4.79,
  discountPct: 31,
  isFlashDeal: false,
  couponEligible: true,
  deliveryEligible: true,
  rawOfferText: 'Leite Betânia de R$ 6,99 por R$ 4,79',
  ...over,
})
const result = (...deals: ExtractedDeal[]): ExtractionResult => ({ neighborhood: null, deals, dropped: 0 })

describe('parseExtraction', () => {
  const raw = (deals: unknown[], hood: string | null = null) =>
    JSON.stringify({ scan_metadata: { supermarket_name: 'X', neighborhood: hood }, deals })
  const item = (over: Record<string, unknown> = {}) => ({
    product_name: 'Leite Integral Betânia 1L',
    category: 'Laticínios e Ovos',
    unit: 'l',
    original_price: 6.99,
    discount_price: 4.79,
    ...over,
  })

  it('recalcula o percentual e a elegibilidade a cupom, ignorando o que o modelo disser', () => {
    const { deals } = parseExtraction(raw([item({ discount_percentage: 99, coupon_eligible: false })]))
    assert.equal(deals[0]!.discountPct, 31) // round((6.99-4.79)/6.99*100)
    assert.equal(deals[0]!.couponEligible, true)
    assert.equal(deals[0]!.wholesaleMinQty, 1)
    assert.equal(deals[0]!.isFlashDeal, false)
  })

  it('desconto abaixo de 15% ou sem preço original não gera cupom', () => {
    const { deals } = parseExtraction(raw([item({ discount_price: 6.2 }), item({ product_name: 'Arroz 1kg', original_price: null })]))
    assert.equal(deals.length, 2)
    assert.equal(deals[0]!.discountPct, 11)
    assert.equal(deals[0]!.couponEligible, false)
    assert.equal(deals[1]!.discountPct, null)
    assert.equal(deals[1]!.couponEligible, false)
  })

  it('tolera cerca de markdown e descarta ofertas inválidas sem derrubar as boas', () => {
    const text = '```json\n' + raw([
      item(),
      item({ category: 'Eletrônicos' }), // categoria fora da lista
      item({ product_name: 'Sem desconto', discount_price: 7 }), // "por" maior que "de"
      item({ product_name: 'Absurdo', discount_price: 0.1 }), // 99%: provável erro/injeção
      item({ product_name: 'Sem preço', discount_price: undefined }),
    ]) + '\n```'
    const out = parseExtraction(text)
    assert.equal(out.deals.length, 1)
    assert.equal(out.dropped, 4)
  })

  it('repetido no mesmo encarte fica com o menor preço', () => {
    const { deals } = parseExtraction(raw([item(), item({ product_name: 'leite integral betânia 1l', discount_price: 4.5 })]))
    assert.equal(deals.length, 1)
    assert.equal(deals[0]!.discountPrice, 4.5)
  })

  it('guarda o bairro do modelo e rejeita resposta que não é JSON', () => {
    assert.equal(parseExtraction(raw([item()], ' Aldeota ')).neighborhood, 'Aldeota')
    assert.throws(() => parseExtraction('Desculpe, não consegui.'), /JSON/)
    assert.throws(() => parseExtraction('{"deals": [{"product_name": "x"}'), /válido/)
    assert.throws(() => parseExtraction('{"foo": 1}'), /deals/)
  })
})

describe('fetcher', () => {
  it('htmlToText tira scripts/estilos/tags, decodifica entidades e mantém JSON-LD', () => {
    const html = `<html><head><style>.a{}</style></head><body><h1>Ofertas &amp; Cia</h1><script>x()</script>
      <p>Leite&nbsp;1L por R$&#32;4,79</p><script type="application/ld+json">{"name":"Arroz"}</script></body></html>`
    const text = htmlToText(html)
    assert.match(text, /Ofertas & Cia/)
    assert.match(text, /Leite 1L por R\$ 4,79/)
    assert.match(text, /\{"name":"Arroz"\}/)
    assert.doesNotMatch(text, /x\(\)|\.a\{\}|<p>/)
  })

  it('robots.txt: a regra mais específica vence e o nosso user-agent tem prioridade sobre *', () => {
    const robots = 'User-agent: *\nDisallow: /privado\nAllow: /privado/encarte\n\nUser-agent: VizinhoHubBot\nDisallow: /bloqueado'
    assert.equal(robotsAllows(robots, 'VizinhoHubBot/1.0', '/bloqueado/x'), false)
    assert.equal(robotsAllows(robots, 'VizinhoHubBot/1.0', '/privado'), true) // grupo próprio não restringe /privado
    assert.equal(robotsAllows(robots, 'OutroBot', '/privado/x'), false)
    assert.equal(robotsAllows(robots, 'OutroBot', '/privado/encarte/1'), true)
    assert.equal(robotsAllows('', 'OutroBot', '/qualquer'), true)
  })
})

describe('scanner', () => {
  let saoLuiz: number
  let sourceId: number
  const URL_A = 'https://exemplo.test/sao-luiz/ofertas'
  const calls = { fetch: 0, extract: 0 }
  let page = 'pagina v1'
  let next: ExtractionResult | Error = result()

  const deps = () => ({
    db: t.db,
    fetchPage: async () => {
      calls.fetch++
      return page
    },
    extract: async () => {
      calls.extract++
      if (next instanceof Error) throw next
      return next
    },
  })
  const status = async () => (await t.db.query('SELECT last_status, last_error, content_hash FROM deal_sources WHERE id = $1', [sourceId])).rows[0]
  const names = async () => (await t.db.query('SELECT product_name FROM deals WHERE active ORDER BY product_name')).rows.map((r) => r.product_name)

  before(async () => {
    saoLuiz = (await t.db.query("SELECT id FROM retail_chains WHERE slug = 'sao-luiz'")).rows[0].id
    sourceId = (await t.db.query('INSERT INTO deal_sources (chain_id, url, neighborhood) VALUES ($1, $2, $3) RETURNING id', [saoLuiz, URL_A, 'Aldeota'])).rows[0].id
  })

  it('lê a fonte, grava as ofertas no bairro da fonte e guarda o hash', async () => {
    next = result(deal(), deal({ productName: 'Arroz Camil 1kg', category: 'Mercearia', unit: 'kg', originalPrice: null, discountPct: null, couponEligible: false, discountPrice: 5.5 }))
    const summary = await runDealsScan(deps())
    assert.deepEqual({ ok: summary.ok, deals: summary.deals, failed: summary.failed }, { ok: 1, deals: 2, failed: 0 })
    assert.deepEqual(await names(), ['Arroz Camil 1kg', 'Leite Integral Betânia 1L'])
    const s = await status()
    assert.equal(s.last_status, 'OK')
    assert.match(s.content_hash, /^[0-9a-f]{64}$/)
    assert.equal((await t.db.query("SELECT neighborhood FROM deals WHERE product_name LIKE 'Leite%'")).rows[0].neighborhood, 'Aldeota')
  })

  it('página idêntica não chama o modelo, só renova as ofertas', async () => {
    const before = calls.extract
    await t.db.query("UPDATE deals SET last_seen_at = now() - interval '10 hours'")
    const summary = await runDealsScan(deps())
    assert.equal(summary.unchanged, 1)
    assert.equal(calls.extract, before)
    assert.equal((await t.db.query("SELECT count(*)::int AS n FROM deals WHERE last_seen_at > now() - interval '1 hour'")).rows[0].n, 2)
  })

  it('página mudou: atualiza o preço, e a oferta que saiu do encarte é desativada', async () => {
    page = 'pagina v2'
    next = result(deal({ discountPrice: 4.49, discountPct: 36 }))
    await runDealsScan(deps())
    assert.deepEqual(await names(), ['Leite Integral Betânia 1L'])
    assert.equal((await t.db.query("SELECT discount_price::float8 AS p, discount_pct FROM deals WHERE product_name LIKE 'Leite%'")).rows[0].p, 4.49)
    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM deals')).rows[0].n, 2) // a do arroz foi só desativada
  })

  it('resposta sem nenhuma oferta não apaga o que existe (status EMPTY)', async () => {
    page = 'pagina v3'
    next = result()
    const summary = await runDealsScan(deps())
    assert.equal(summary.empty, 1)
    assert.deepEqual(await names(), ['Leite Integral Betânia 1L'])
    assert.equal((await status()).last_status, 'EMPTY')
  })

  it('erro na fonte é registrado e não derruba a varredura', async () => {
    page = 'pagina v4'
    next = new Error('modelo fora do ar')
    const summary = await runDealsScan(deps())
    assert.equal(summary.failed, 1)
    const s = await status()
    assert.equal(s.last_status, 'ERROR')
    assert.equal(s.last_error, 'modelo fora do ar')
    assert.deepEqual(await names(), ['Leite Integral Betânia 1L'])
  })

  it('duas varreduras ao mesmo tempo: a segunda é pulada pela trava', async () => {
    page = 'pagina v5'
    next = result(deal())
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = runDealsScan({ ...deps(), extract: async () => (await gate, result(deal())) })
    await new Promise((r) => setTimeout(r, 200))
    const second = await runDealsScan(deps())
    assert.equal(second.skipped, true)
    release()
    assert.equal((await slow).skipped, false)
  })
})

describe('API de ofertas', () => {
  const ids: Record<string, string> = {}
  const get = (q = '') => t.api('GET', `/api/v1/deals${q}`)

  before(async () => {
    const pinheiro = (await t.db.query("SELECT id FROM retail_chains WHERE slug = 'pinheiro'")).rows[0].id
    const src = (await t.db.query("INSERT INTO deal_sources (chain_id, url) VALUES ($1, 'https://exemplo.test/pinheiro') RETURNING id", [pinheiro])).rows[0].id
    const insert = async (key: string, name: string, hood: string | null, pct: number | null, extra: { flash?: boolean; coupon?: boolean } = {}) => {
      const { rows } = await t.db.query(
        `INSERT INTO deals (chain_id, source_id, neighborhood, product_name, category, unit, original_price, discount_price, discount_pct, is_flash_deal, coupon_eligible)
         VALUES ($1, $2, $3, $4, 'Mercearia', 'un', $5, 4, $6, $7, $8) RETURNING id`,
        [pinheiro, src, hood, name, pct === null ? null : 10, pct, extra.flash ?? false, extra.coupon ?? (pct !== null && pct >= 15)],
      )
      ids[key] = rows[0].id
    }
    await insert('cafe', 'Café Pilão 500g', 'Aldeota', 40, { flash: true })
    await insert('acucar', 'Açúcar União 1kg', null, 20) // rede toda
    await insert('feijao', 'Feijão Camil 1kg', 'Messejana', 10)
    await insert('sal', 'Sal Cisne 1kg', 'Aldeota', null)
    await insert('velho', 'Óleo de Soja 900ml', 'Aldeota', 30)
    await t.db.query("UPDATE deals SET last_seen_at = now() - interval '25 hours' WHERE id = $1", [ids.velho!])
    await insert('desativado', 'Macarrão 500g', 'Aldeota', 30)
    await t.db.query('UPDATE deals SET active = FALSE WHERE id = $1', [ids.desativado!])
  })

  it('é pública, ordena pelo maior desconto e esconde oferta velha (>24h) e desativada', async () => {
    const res = await get('?chain=pinheiro')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.map((d: { productName: string }) => d.productName), ['Café Pilão 500g', 'Açúcar União 1kg', 'Feijão Camil 1kg', 'Sal Cisne 1kg'])
    const cafe = res.body[0]
    assert.equal(cafe.chain.name, 'Supermercado Pinheiro')
    assert.equal(cafe.discountPrice, 4)
    assert.equal(cafe.originalPrice, 10)
    assert.equal(cafe.isFlashDeal, true)
    assert.equal('rawOfferText' in cafe, false)
  })

  it('filtra por bairro (incluindo a rede toda), busca sem acento, cupom e relâmpago', async () => {
    const names = async (q: string) => (await get(`?chain=pinheiro&${q}`)).body.map((d: { productName: string }) => d.productName)
    assert.deepEqual(await names('neighborhood=aldeota'), ['Café Pilão 500g', 'Açúcar União 1kg', 'Sal Cisne 1kg'])
    assert.deepEqual(await names('search=ACUCAR'), ['Açúcar União 1kg'])
    assert.deepEqual(await names('search=%25'), [])
    assert.deepEqual(await names('couponEligible=true'), ['Café Pilão 500g', 'Açúcar União 1kg'])
    assert.deepEqual(await names('flash=true'), ['Café Pilão 500g'])
    assert.deepEqual(await names('category=Mercearia&limit=1&offset=1'), ['Açúcar União 1kg'])
    assert.equal((await get('?category=Eletronicos')).status, 400)
    assert.equal((await get('?limit=9999')).status, 400)
  })

  it('GET /deals/:id e /deals/chains', async () => {
    assert.equal((await get(`/${ids.cafe!}`)).body.productName, 'Café Pilão 500g')
    assert.equal((await get(`/${ids.velho!}`)).status, 404)
    assert.equal((await get('/abc')).status, 400)
    const chains = (await get('/chains')).body
    assert.equal(chains.length, 19)
    assert.equal(chains.find((c: { slug: string }) => c.slug === 'pinheiro').dealCount, 4)
    assert.equal(chains.find((c: { slug: string }) => c.slug === 'assai').kind, 'WHOLESALE')
  })

  it('cupom: exige login, só para oferta elegível, um ativo por oferta', async () => {
    const claim = (id: string, token?: string) => t.api('POST', `/api/v1/deals/${id}/coupon`, { token })
    assert.equal((await claim(ids.cafe!)).status, 401)
    assert.equal((await claim(ids.feijao!, tokenFor(MARIA))).status, 422) // 10% < 15%
    assert.equal((await claim(ids.velho!, tokenFor(MARIA))).status, 404)

    const ok = await claim(ids.cafe!, tokenFor(MARIA))
    assert.equal(ok.status, 201)
    assert.match(ok.body.code, /^[A-HJ-NP-Z2-9]{8}$/)
    assert.equal(ok.body.status, 'ACTIVE')
    assert.equal(ok.body.productName, 'Café Pilão 500g')
    assert.equal(ok.body.unitPrice, 4)
    assert.equal(ok.body.originalPrice, 10) // "de" gravado no cupom
    assert.equal(ok.body.profit, 6) // (10 - 4) * min_qty 1: o que a rede repassa ao VizinhoHub
    assert.equal(ok.body.chain.name, 'Supermercado Pinheiro')
    const hours = (Date.parse(ok.body.expiresAt) - Date.parse(ok.body.createdAt)) / 3_600_000
    assert.ok(Math.abs(hours - 24) < 0.01)

    assert.equal((await claim(ids.cafe!, tokenFor(MARIA))).status, 409)
    assert.equal((await claim(ids.cafe!, tokenFor(LUCIA))).status, 201) // outro cliente pode
  })

  it('o cupom guarda o preço da reserva mesmo se a oferta mudar; vencido aparece como EXPIRED e pode ser refeito', async () => {
    await t.db.query('UPDATE deals SET discount_price = 9 WHERE id = $1', [ids.cafe!])
    const mine = await t.api('GET', '/api/v1/coupons/mine', { token: tokenFor(MARIA) })
    assert.equal(mine.status, 200)
    assert.equal(mine.body.length, 1)
    assert.equal(mine.body[0].unitPrice, 4)
    assert.equal(mine.body[0].originalPrice, 10)
    assert.equal(mine.body[0].profit, 6)

    await t.db.query("UPDATE deal_coupons SET expires_at = now() - interval '1 minute' WHERE customer_id = $1", [MARIA])
    assert.equal((await t.api('GET', '/api/v1/coupons/mine', { token: tokenFor(MARIA) })).body[0].status, 'EXPIRED')

    const again = await t.api('POST', `/api/v1/deals/${ids.cafe!}/coupon`, { token: tokenFor(MARIA) })
    assert.equal(again.status, 201)
    assert.equal(again.body.unitPrice, 9)
    assert.equal(again.body.originalPrice, 10)
    assert.equal(again.body.profit, 1)
    const all = (await t.api('GET', '/api/v1/coupons/mine', { token: tokenFor(MARIA) })).body
    assert.deepEqual(all.map((c: { status: string }) => c.status), ['ACTIVE', 'EXPIRED'])

    assert.equal((await t.api('GET', '/api/v1/coupons/mine')).status, 401)
  })

  describe('confirmação da compra', () => {
    const confirm = (id: string, token?: string) => t.api('POST', `/api/v1/coupons/${id}/confirm`, { token })
    const mine = async (who: string) => (await t.api('GET', '/api/v1/coupons/mine', { token: tokenFor(who) })).body
    const activeOf = async (who: string): Promise<string> => (await mine(who)).find((c: { status: string }) => c.status === 'ACTIVE').id

    it('cliente confirma: vira REDEEMED com redeemedAt e aparece em /coupons/mine; confirmar de novo dá 409', async () => {
      const id = await activeOf(MARIA)
      assert.equal((await mine(MARIA)).find((c: { id: string }) => c.id === id).redeemedAt, null)

      const ok = await confirm(id, tokenFor(MARIA))
      assert.equal(ok.status, 200)
      assert.equal(ok.body.id, id)
      assert.equal(ok.body.status, 'REDEEMED')
      assert.match(ok.body.redeemedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      assert.equal(ok.body.profit, 1)

      const listed = (await mine(MARIA)).find((c: { id: string }) => c.id === id)
      assert.equal(listed.status, 'REDEEMED')
      assert.equal(listed.redeemedAt, ok.body.redeemedAt)

      const again = await confirm(id, tokenFor(MARIA))
      assert.equal(again.status, 409)
      assert.equal(again.body.error.code, 'COUPON_ALREADY_CONFIRMED')
    })

    it('cupom de outro cliente ou inexistente dá 404; sem login dá 401; id inválido dá 400', async () => {
      const id = await activeOf(LUCIA)
      const other = await confirm(id, tokenFor(MARIA))
      assert.equal(other.status, 404)
      assert.equal(other.body.error.code, 'COUPON_NOT_FOUND')
      assert.equal((await confirm('00000000-0000-4000-8000-000000000000', tokenFor(MARIA))).status, 404)
      assert.equal((await confirm(id)).status, 401)
      assert.equal((await confirm('abc', tokenFor(LUCIA))).status, 400)
      assert.equal((await mine(LUCIA)).find((c: { id: string }) => c.id === id).status, 'ACTIVE') // nada mudou
    })

    it('cupom vencido dá 409 COUPON_EXPIRED e não vira REDEEMED', async () => {
      const id = await activeOf(LUCIA)
      await t.db.query("UPDATE deal_coupons SET expires_at = now() - interval '1 minute' WHERE id = $1", [id])
      const res = await confirm(id, tokenFor(LUCIA))
      assert.equal(res.status, 409)
      assert.equal(res.body.error.code, 'COUPON_EXPIRED')
      const row = (await t.db.query('SELECT status, redeemed_at FROM deal_coupons WHERE id = $1', [id])).rows[0]
      assert.equal(row.redeemed_at, null)
      assert.notEqual(row.status, 'REDEEMED')
    })

    it('duas confirmações simultâneas: exatamente uma 200 e uma 409', async () => {
      const made = await t.api('POST', `/api/v1/deals/${ids.cafe!}/coupon`, { token: tokenFor(LUCIA) }) // o anterior venceu: pode reservar de novo
      assert.equal(made.status, 201)
      const results = await Promise.all([confirm(made.body.id, tokenFor(LUCIA)), confirm(made.body.id, tokenFor(LUCIA))])
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
    })
  })
})

describe('upload de encarte', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
  const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(64))
  const lucia = () => tokenFor(LUCIA)

  const upload = async (query: string, body?: Buffer, token?: string) => {
    const res = await fetch(`${t.baseUrl}/api/v1/deals/flyers?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...(token && { authorization: `Bearer ${token}` }) },
      body: body && new Uint8Array(body),
    })
    return { status: res.status, body: await res.json().catch(() => undefined) }
  }
  const settle = async (id: string) => {
    for (let i = 0; i < 50; i++) {
      const res = await t.api('GET', `/api/v1/deals/flyers/${id}`, { token: lucia() })
      if (res.body.status !== 'PROCESSING') return res.body
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('o envio não terminou')
  }
  const live = async (q: string) =>
    (await t.api('GET', `/api/v1/deals?chain=sao-luiz&search=encarte&${q}`)).body.map((d: { productName: string }) => d.productName).sort()
  const only = (name: string, over: Partial<ExtractedDeal> = {}) => deal({ productName: name, ...over })

  before(async () => {
    await t.db.query("INSERT INTO retail_chain_managers (chain_id, user_id) SELECT id, $1 FROM retail_chains WHERE slug = 'sao-luiz'", [LUCIA])
  })

  it('só gerente da rede envia: login, papel e autorização', async () => {
    assert.equal((await upload('chain=sao-luiz', PNG)).status, 401)
    assert.equal((await upload('chain=sao-luiz', PNG, tokenFor(MARIA))).status, 403) // cliente
    assert.equal((await upload('chain=sao-luiz', PNG, tokenFor(ZE))).body.error.code, 'NOT_CHAIN_MANAGER') // comerciante de outra loja
    assert.equal((await upload('chain=nao-existe', PNG, lucia())).status, 404)
    assert.equal((await upload('', PNG, lucia())).status, 400) // falta ?chain=
    assert.equal((await upload('chain=sao-luiz&validDays=99', PNG, lucia())).status, 400)
  })

  it('valida o arquivo pelos bytes, não pelo Content-Type', async () => {
    assert.equal((await upload('chain=sao-luiz', undefined, lucia())).body.error.code, 'FILE_REQUIRED')
    assert.equal((await upload('chain=sao-luiz', Buffer.from('<html>nao sou imagem</html>'.repeat(5)), lucia())).status, 415)
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024)])
    assert.equal((await upload('chain=sao-luiz', big, lucia())).body.error.code, 'FILE_TOO_LARGE')
    assert.equal(flyerCalls.length, 0) // nada disso chegou ao modelo
  })

  it('aceita o encarte, responde 202 e lê em segundo plano; as ofertas valem pela validade informada', async () => {
    flyerExtract = async () => result(only('Café Encarte 500g'), only('Arroz Encarte 1kg', { category: 'Mercearia', unit: 'kg' }))
    const res = await upload('chain=sao-luiz&neighborhood=Parquel%C3%A2ndia&validDays=3&fileName=encarte.png', PNG, lucia())
    assert.equal(res.status, 202)
    assert.equal(res.body.status, 'PROCESSING')
    assert.equal(res.body.mediaType, 'image/png')
    assert.equal(res.body.chain.name, 'Mercadinhos São Luiz')

    const done = await settle(res.body.id)
    assert.deepEqual({ status: done.status, items: done.itemsExtracted, error: done.error }, { status: 'SUCCESS', items: 2, error: null })

    const call = flyerCalls.at(-1)!
    assert.equal(call.chainName, 'Mercadinhos São Luiz')
    assert.equal(call.neighborhood, 'Parquelândia')
    assert.equal(call.file?.mediaType, 'image/png')
    assert.equal(call.file?.data.length, PNG.length)

    assert.deepEqual(await live('neighborhood=Parquelandia'), ['Arroz Encarte 1kg', 'Café Encarte 500g'])
    const { rows } = await t.db.query("SELECT extract(epoch FROM valid_until - now()) / 86400 AS days FROM deals WHERE product_name = 'Café Encarte 500g'")
    assert.ok(Math.abs(Number(rows[0].days) - 3) < 0.01, 'valid_until ≈ 3 dias')

    // Encarte vale pela validade, não pelas 24 h de last_seen_at.
    await t.db.query("UPDATE deals SET last_seen_at = now() - interval '3 days' WHERE product_name LIKE '%Encarte%'")
    assert.equal((await live('')).length, 2)
    await t.db.query("UPDATE deals SET valid_until = now() - interval '1 minute' WHERE product_name LIKE '%Encarte%'")
    assert.equal((await live('')).length, 0)
  })

  it('encarte novo substitui o anterior; append=true acrescenta (página 2)', async () => {
    flyerExtract = async () => result(only('Leite Encarte 1L'))
    await settle((await upload('chain=sao-luiz&neighborhood=Aldeota', PDF, lucia())).body.id)
    assert.deepEqual(await live('neighborhood=Aldeota'), ['Leite Encarte 1L'])

    flyerExtract = async () => result(only('Pão Encarte'))
    await settle((await upload('chain=sao-luiz&neighborhood=Aldeota&append=true', PDF, lucia())).body.id)
    assert.deepEqual(await live('neighborhood=Aldeota'), ['Leite Encarte 1L', 'Pão Encarte'])

    flyerExtract = async () => result(only('Suco Encarte'))
    await settle((await upload('chain=sao-luiz&neighborhood=Aldeota', PDF, lucia())).body.id)
    assert.deepEqual(await live('neighborhood=Aldeota'), ['Suco Encarte'])
    assert.equal(flyerCalls.at(-1)!.file?.mediaType, 'application/pdf')
  })

  it('arquivo sem ofertas ou falha do modelo viram FAILED, sem vazar o erro interno e sem apagar o que existe', async () => {
    flyerExtract = async () => result()
    const empty = await settle((await upload('chain=sao-luiz&neighborhood=Aldeota', PNG, lucia())).body.id)
    assert.equal(empty.status, 'FAILED')
    assert.match(empty.error, /Nenhuma oferta/)

    flyerExtract = async () => {
      throw new Error('segredo: chave sk-ant-xxxx inválida')
    }
    const failed = await settle((await upload('chain=sao-luiz&neighborhood=Aldeota', PNG, lucia())).body.id)
    assert.equal(failed.status, 'FAILED')
    assert.doesNotMatch(failed.error, /segredo|sk-ant/)

    assert.deepEqual(await live('neighborhood=Aldeota'), ['Suco Encarte'])
  })

  it('cada gerente vê só os próprios envios', async () => {
    const mine = await t.api('GET', '/api/v1/deals/flyers', { token: lucia() })
    assert.equal(mine.status, 200)
    assert.ok(mine.body.length >= 6)
    assert.equal((await t.api('GET', '/api/v1/deals/flyers', { token: tokenFor(ZE) })).body.length, 0)
    assert.equal((await t.api('GET', `/api/v1/deals/flyers/${mine.body[0].id}`, { token: tokenFor(ZE) })).status, 404)
    assert.equal((await t.api('GET', '/api/v1/deals/flyers')).status, 401)
  })

  it('a varredura horária ignora fontes de encarte (não há página para buscar)', async () => {
    const urls: string[] = []
    await runDealsScan({
      db: t.db,
      fetchPage: async (url) => (urls.push(url), 'pagina'),
      extract: async () => result(),
    })
    assert.ok(urls.length > 0)
    assert.equal(urls.some((u) => u.startsWith('flyer:')), false)
  })
})

describe('foto da oferta (image)', () => {
  const ids: Record<string, string> = {}
  let chainId: number
  const IMG_CHAIN = 'assai'
  const list = async () => (await t.api('GET', `/api/v1/deals?chain=${IMG_CHAIN}`)).body as { id: string; productName: string; image: string | null }[]
  const imageOf = async (key: string) => (await list()).find((d) => d.id === ids[key])?.image

  before(async () => {
    chainId = (await t.db.query('SELECT id FROM retail_chains WHERE slug = $1', [IMG_CHAIN])).rows[0].id
    const src = (await t.db.query("INSERT INTO deal_sources (chain_id, url) VALUES ($1, 'https://exemplo.test/assai-imagens') RETURNING id", [chainId])).rows[0].id
    const product = (name: string, image: string | null, active = true) =>
      t.db.query('INSERT INTO products (user_id, category_id, name, price, stock_qty, image, active) VALUES ($1, 1, $2, 5, 10, $3, $4)', [ZE, name, image, active])
    const offer = async (key: string, name: string) => {
      const { rows } = await t.db.query(
        `INSERT INTO deals (chain_id, source_id, product_name, category, unit, original_price, discount_price, discount_pct)
         VALUES ($1, $2, $3, 'Mercearia', 'un', 10, 4, 60) RETURNING id`,
        [chainId, src, name],
      )
      ids[key] = rows[0].id
    }
    await product('Biscoito Recheado Chocolate Trakinas 126g', 'trakinas.png')
    await product('Sabonete Líquido Dove Hidratação 250ml', 'dove-inativo.png', false) // inativo: nunca é usado
    await product('Shampoo Pantene Restauração 400ml', null) // sem foto: nunca é usado
    await product('Suco de Uva Integral Del Valle 1L', 'uva-certo.png')
    await product('Suco de Uva Integral Aurora 1L', 'uva-aurora.png')
    await product('Suco de Uva Integral Del Valle 1,5L', 'uva-15l.png')

    await offer('trakinas', 'BISCOITO RECHEADO CHOCOLATE TRAKINAS 126G') // caixa e acento diferentes do catálogo
    await offer('furadeira', 'Furadeira de Impacto Bosch 500W')
    await offer('dove', 'Sabonete Líquido Dove Hidratação 250ml')
    await offer('pantene', 'Shampoo Pantene Restauração 400ml')
    await offer('suco', 'Suco de Uva Integral Del Valle 1L')
  })
  after(async () => {
    await t.db.query('DELETE FROM deals WHERE chain_id = $1', [chainId])
    await t.db.query("DELETE FROM products WHERE image IN ('trakinas.png','dove-inativo.png','uva-certo.png','uva-aurora.png','uva-15l.png') OR name = 'Shampoo Pantene Restauração 400ml'")
  })

  it('oferta parecida com produto do catálogo recebe a foto dele (sem diferenciar caixa nem acento)', async () => {
    assert.equal(await imageOf('trakinas'), 'trakinas.png')
  })

  it('oferta sem produto parecido fica com image null', async () => {
    assert.equal(await imageOf('furadeira'), null)
  })

  it('produto inativo ou sem foto nunca é usado, mesmo com nome idêntico', async () => {
    assert.equal(await imageOf('dove'), null)
    assert.equal(await imageOf('pantene'), null)
  })

  it('vários produtos parecidos: a lista não duplica a oferta e escolhe o mais parecido', async () => {
    const all = await list()
    assert.equal(all.length, 5)
    assert.equal(new Set(all.map((d) => d.id)).size, 5)
    assert.equal(all.filter((d) => d.productName === 'Suco de Uva Integral Del Valle 1L').length, 1)
    assert.equal(await imageOf('suco'), 'uva-certo.png') // exato vence "Aurora" e "1,5L"
  })

  it('GET /deals/:id também traz a foto', async () => {
    const hit = await t.api('GET', `/api/v1/deals/${ids.suco!}`)
    assert.equal(hit.status, 200)
    assert.equal(hit.body.image, 'uva-certo.png')
    const miss = await t.api('GET', `/api/v1/deals/${ids.furadeira!}`)
    assert.equal(miss.status, 200)
    assert.equal(miss.body.image, null)
  })
})
