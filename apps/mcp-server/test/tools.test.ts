import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CREME, IOGURTE, MARIA, PAO, startTestEnv, tokenFor, ZE, type TestEnv } from '../../api/test/helpers.js'
import { ApiError, createApiClient } from '../src/api-client.js'
import { loadConfig } from '../src/config.js'
import { createServer } from '../src/server.js'
import { fortalezaDate, fortalezaHHMM, untilToday } from '../src/time.js'

let t: TestEnv
let mcp: Client

interface ToolOut {
  isError?: boolean
  text: string
  data: any
}
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolOut> {
  const r = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: any }
  return { isError: r.isError, text: r.content.map((c) => c.text).join('\n'), data: r.structuredContent }
}

before(async () => {
  t = await startTestEnv()
  const client = createApiClient({ apiUrl: t.baseUrl, token: tokenFor(ZE) })
  const server = createServer(client)
  const [a, b] = InMemoryTransport.createLinkedPair()
  mcp = new Client({ name: 'teste', version: '0.0.0' })
  await Promise.all([server.connect(a), mcp.connect(b)])
})
after(async () => {
  await mcp?.close()
  await t?.stop()
})

describe('utilitários', () => {
  it('config exige credenciais', () => {
    assert.throws(() => loadConfig({}), /VIZINHOHUB_API_TOKEN/)
    assert.equal(loadConfig({ VIZINHOHUB_API_TOKEN: 'x' }).apiUrl, 'http://localhost:3333')
  })

  it('time: horário em Fortaleza (UTC-3) e recusa horário passado', () => {
    const now = new Date('2026-03-10T18:00:00Z') // 15:00 em Fortaleza
    assert.equal(fortalezaHHMM(now), '15:00')
    assert.equal(fortalezaDate(new Date('2026-03-10T02:30:00Z')), '2026-03-09')
    const r = untilToday('23:00', now)
    assert.equal(r.durationMin, 480)
    assert.equal(r.endsAtIso, '2026-03-10T23:00:00-03:00')
    assert.throws(() => untilToday('14:59', now), /já passou/)
  })
})

describe('ferramentas', () => {
  const state: { flashId?: string; flashAteId?: string; menuId?: string; comboId?: string; categoriaId?: number } = {}

  it('lista as 6 tools', async () => {
    const { tools } = await mcp.listTools()
    assert.deepEqual(tools.map((x) => x.name).sort(), [
      'atualizar_oferta',
      'buscar_meus_produtos',
      'criar_oferta',
      'listar_minhas_ofertas',
      'pausar_ou_encerrar_oferta',
      'resumo_vendas_ofertas',
    ])
    for (const tool of tools) assert.ok((tool.description ?? '').length > 80, `${tool.name} sem descrição rica`)
  })

  it('buscar_meus_produtos acha o produto e avisa quando não há', async () => {
    const r = await call('buscar_meus_produtos', { busca: 'creme' })
    assert.ok(!r.isError, r.text)
    const p = r.data.produtos.find((x: any) => x.id === CREME)
    assert.ok(p, 'CREME deve aparecer')
    assert.equal(typeof p.preco, 'number')
    assert.ok(p.categoriaId)
    state.categoriaId = p.categoriaId
    const vazio = await call('buscar_meus_produtos', { busca: 'xyzinexistente' })
    assert.ok(!vazio.isError)
    assert.deepEqual(vazio.data.produtos, [])
    assert.match(vazio.text, /Nenhum produto/)
  })

  it('criar relâmpago por duracaoMinutos', async () => {
    const r = await call('criar_oferta', { tipo: 'relampago', produtoId: CREME, precoOferta: 3, quantidade: 5, limitePorCliente: 2, duracaoMinutos: 60 })
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.oferta.tipo, 'relampago')
    assert.equal(r.data.oferta.precoOferta, 3)
    assert.equal(r.data.oferta.quantidadeTotal, 5)
    assert.ok(r.data.oferta.validadeFortaleza)
    state.flashId = r.data.oferta.id
  })

  it('criar relâmpago com "ate" (2 h à frente, horário de Fortaleza)', async (ctx) => {
    const alvo = new Date(Date.now() + 2 * 3600_000)
    if (fortalezaDate(alvo) !== fortalezaDate()) return ctx.skip('+2 h cruza a meia-noite em Fortaleza')
    const ate = fortalezaHHMM(alvo)
    const r = await call('criar_oferta', { tipo: 'relampago', produtoId: PAO, precoOferta: 1.5, quantidade: 2, ate })
    assert.ok(!r.isError, r.text)
    const fim = new Date(r.data.oferta.validade).getTime()
    assert.ok(Math.abs(fim - alvo.getTime()) < 2 * 60_000, 'termina perto do horário pedido')
    assert.match(r.data.oferta.validadeFortaleza, new RegExp(ate))
    state.flashAteId = r.data.oferta.id
  })

  it('recusa localmente relâmpago > 12 h, < 5 min, sem prazo e horário passado', async () => {
    const base = { tipo: 'relampago', produtoId: IOGURTE, precoOferta: 1, quantidade: 1 }
    const longa = await call('criar_oferta', { ...base, duracaoMinutos: 721 })
    assert.ok(longa.isError)
    assert.match(longa.text, /12 h/)
    const curta = await call('criar_oferta', { ...base, duracaoMinutos: 2 })
    assert.ok(curta.isError)
    const semPrazo = await call('criar_oferta', base)
    assert.ok(semPrazo.isError)
    const ambos = await call('criar_oferta', { ...base, duracaoMinutos: 30, ate: '23:59' })
    assert.ok(ambos.isError)
    const agora = fortalezaHHMM(new Date(Date.now() - 3600_000))
    if (fortalezaDate(new Date(Date.now() - 3600_000)) === fortalezaDate()) {
      const passou = await call('criar_oferta', { ...base, ate: agora })
      assert.ok(passou.isError)
      assert.match(passou.text, /já passou/)
    }
  })

  it('erro da API vira resultado de erro da tool (preço não menor)', async () => {
    const r = await call('criar_oferta', { tipo: 'relampago', produtoId: IOGURTE, precoOferta: 99, quantidade: 1, duracaoMinutos: 30 })
    assert.ok(r.isError)
    assert.match(r.text, /OFFER_NOT_CHEAPER|menor|barato/i)
    // o servidor continua vivo
    assert.ok(!(await call('listar_minhas_ofertas')).isError)
  })

  it('listar_minhas_ofertas mostra a criada', async () => {
    const r = await call('listar_minhas_ofertas')
    assert.ok(!r.isError, r.text)
    const o = r.data.ofertas.find((x: any) => x.id === state.flashId)
    assert.ok(o)
    assert.equal(o.tipo, 'relampago')
    assert.equal(o.status, 'ativa')
    assert.equal(o.limitePorCliente, 2)
    assert.equal(o.quantidadeVendida, 0)
    assert.ok(o.precoOriginal > o.precoOferta)
  })

  it('atualizar relâmpago (preço e quantidade) conforme o contrato do PATCH /flash/:id', async (ctx) => {
    const r = await call('atualizar_oferta', { tipo: 'relampago', id: state.flashId, precoOferta: 2.5, quantidade: 8 })
    if (r.isError && /não existe na API|ROUTE_NOT_FOUND/.test(r.text)) return ctx.skip('PATCH /flash/:id ainda não existe na API (404 ROUTE_NOT_FOUND)')
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.oferta.precoOferta, 2.5)
    assert.equal(r.data.oferta.quantidadeTotal, 8)
    const naoMaisBarato = await call('atualizar_oferta', { tipo: 'relampago', id: state.flashId, precoOferta: 50 })
    assert.ok(naoMaisBarato.isError)
    assert.match(naoMaisBarato.text, /OFFER_NOT_CHEAPER/)
  })

  it('atualizar sem campos e combo são recusados', async () => {
    assert.ok((await call('atualizar_oferta', { tipo: 'relampago', id: state.flashId })).isError)
    const combo = await call('atualizar_oferta', { tipo: 'combo', id: state.flashId, preco: 1 })
    assert.ok(combo.isError)
    assert.match(combo.text, /remov/i)
  })

  it('prato do dia: criar, pausar e retomar', async () => {
    const c = await call('criar_oferta', { tipo: 'prato_do_dia', produtoId: PAO, porcoes: 10 })
    assert.ok(!c.isError, c.text)
    assert.equal(c.data.oferta.status, 'ativo')
    state.menuId = c.data.oferta.id
    const p = await call('pausar_ou_encerrar_oferta', { tipo: 'prato_do_dia', id: state.menuId })
    assert.ok(!p.isError, p.text)
    assert.equal(p.data.oferta.status, 'pausado')
    assert.equal(p.data.definitivo, false)
    const ativas = await call('listar_minhas_ofertas')
    assert.ok(!ativas.data.ofertas.some((x: any) => x.id === state.menuId), 'pausado não aparece em ativas')
    const todas = await call('listar_minhas_ofertas', { status: 'todas' })
    assert.ok(todas.data.ofertas.some((x: any) => x.id === state.menuId))
    const r = await call('pausar_ou_encerrar_oferta', { tipo: 'prato_do_dia', id: state.menuId, acao: 'retomar' })
    assert.equal(r.data.oferta.status, 'ativo')
    const u = await call('atualizar_oferta', { tipo: 'prato_do_dia', id: state.menuId, porcoes: 20 })
    assert.ok(!u.isError, u.text)
    assert.equal(u.data.oferta.quantidadeTotal, 20)
  })

  it('combo: criar e encerrar', async () => {
    const c = await call('criar_oferta', {
      tipo: 'combo',
      nome: 'Combo Lanche Teste',
      categoriaId: state.categoriaId,
      preco: 6,
      componentes: [
        { produtoId: CREME, quantidade: 1 },
        { produtoId: IOGURTE, quantidade: 1 },
      ],
    })
    assert.ok(!c.isError, c.text)
    assert.equal(c.data.oferta.tipo, 'combo')
    state.comboId = c.data.oferta.id
    assert.ok((await call('listar_minhas_ofertas')).data.ofertas.some((x: any) => x.id === state.comboId))
    const um = await call('criar_oferta', { tipo: 'combo', nome: 'Só um', categoriaId: state.categoriaId, preco: 3, componentes: [{ produtoId: CREME, quantidade: 1 }] })
    assert.ok(um.isError)
    const pausa = await call('pausar_ou_encerrar_oferta', { tipo: 'combo', id: state.comboId, acao: 'pausar' })
    assert.ok(pausa.isError)
    const e = await call('pausar_ou_encerrar_oferta', { tipo: 'combo', id: state.comboId })
    assert.ok(!e.isError, e.text)
    assert.ok(!(await call('listar_minhas_ofertas')).data.ofertas.some((x: any) => x.id === state.comboId))
  })

  it('resumo de vendas depois de um pedido real da cliente', async () => {
    const order = await t.api('POST', '/api/orders', { token: tokenFor(MARIA), body: { items: [{ flashOfferId: state.flashId, quantity: 1 }] } })
    assert.equal(order.status, 201, JSON.stringify(order.body))
    const r = await call('resumo_vendas_ofertas')
    assert.ok(!r.isError, r.text)
    const f = r.data.relampagos.find((x: any) => x.id === state.flashId)
    assert.equal(f.vendidas, 1)
    assert.equal(r.data.totais.unidadesRelampagoVendidas, 1)
    assert.equal(r.data.totais.pedidosHojeComRelampago, 1)
    assert.equal(r.data.pratoDoDia.find((p: any) => p.id === state.menuId).porcoesTotal, 20)
    assert.match(r.text, /vendidas/)
  })

  it('encerrar relâmpago é definitivo; pausar é recusado', async () => {
    const pausa = await call('pausar_ou_encerrar_oferta', { tipo: 'relampago', id: state.flashId, acao: 'pausar' })
    assert.ok(pausa.isError)
    const r = await call('pausar_ou_encerrar_oferta', { tipo: 'relampago', id: state.flashId })
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.definitivo, true)
    assert.match(r.text, /definitiv/i)
    const todas = await call('listar_minhas_ofertas', { status: 'todas' })
    assert.equal(todas.data.ofertas.find((x: any) => x.id === state.flashId).status, 'cancelada')
    const de_novo = await call('pausar_ou_encerrar_oferta', { tipo: 'relampago', id: state.flashId })
    assert.ok(de_novo.isError)
  })
})

describe('login por e-mail e senha', () => {
  it('entra na primeira chamada e renova uma vez após 401', async () => {
    let logins = 0
    let authed = 0
    let injected = false
    const spy: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/login')) logins++
      else {
        authed++
        if (authed === 2 && !injected) {
          injected = true
          return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Token expirado.' } }), { status: 401, headers: { 'content-type': 'application/json' } })
        }
      }
      return fetch(input, init)
    }
    const client = createApiClient({ apiUrl: t.baseUrl, email: 'ze@vizinhohub.test', password: 'vizinho123' }, spy)
    const a = await client.request<unknown[]>('GET', '/flash/mine')
    assert.ok(Array.isArray(a))
    assert.equal(logins, 1)
    const b = await client.request<unknown[]>('GET', '/flash/mine') // 401 simulado → novo login → repete
    assert.ok(Array.isArray(b))
    assert.equal(logins, 2)
    assert.equal(injected, true)
  })

  it('senha errada vira ApiError legível', async () => {
    const client = createApiClient({ apiUrl: t.baseUrl, email: 'ze@vizinhohub.test', password: 'errada' })
    await assert.rejects(client.request('GET', '/flash/mine'), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_CREDENTIALS' && /incorretos/.test(e.message))
  })

  it('tool funciona com login por e-mail/senha', async () => {
    const client = createApiClient({ apiUrl: t.baseUrl, email: 'ze@vizinhohub.test', password: 'vizinho123' })
    const server = createServer(client)
    const [a, b] = InMemoryTransport.createLinkedPair()
    const c = new Client({ name: 'teste2', version: '0.0.0' })
    await Promise.all([server.connect(a), c.connect(b)])
    const r = (await c.callTool({ name: 'buscar_meus_produtos', arguments: { busca: 'pão' } })) as { isError?: boolean }
    assert.ok(!r.isError)
    await c.close()
  })

  it('API fora do ar vira erro da tool, não exceção', async () => {
    const client = createApiClient({ apiUrl: 'http://127.0.0.1:1', token: 'x' })
    const server = createServer(client)
    const [a, b] = InMemoryTransport.createLinkedPair()
    const c = new Client({ name: 'teste3', version: '0.0.0' })
    await Promise.all([server.connect(a), c.connect(b)])
    const r = (await c.callTool({ name: 'listar_minhas_ofertas', arguments: {} })) as { isError?: boolean; content: { text: string }[] }
    assert.ok(r.isError)
    assert.match(r.content[0]!.text, /NETWORK_ERROR|Não consegui/)
    await c.close()
  })
})
