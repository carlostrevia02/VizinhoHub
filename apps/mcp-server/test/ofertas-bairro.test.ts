import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ApiError, type ApiClient } from '../src/api-client.js'
import { registerOfertasBairroTools } from '../src/tools-ofertas-bairro.js'

const REDES = [
  { id: 1, slug: 'sao-luiz', name: 'Mercadinhos São Luiz', kind: 'RETAIL', dealCount: 2 },
  { id: 3, slug: 'extra-sao-jose', name: 'Extra São José', kind: 'RETAIL', dealCount: 1 },
  { id: 4, slug: 'extra-sao-paulo', name: 'Extra São Paulo', kind: 'RETAIL', dealCount: 0 },
]
const LEITE = {
  id: 'd1',
  chain: { id: 1, slug: 'sao-luiz', name: 'Mercadinhos São Luiz' },
  neighborhood: 'Aldeota',
  productName: 'Leite Integral Betânia 1L',
  category: 'Laticínios e Ovos',
  brand: 'Betânia',
  unit: 'un',
  wholesaleMinQty: 1,
  originalPrice: 6,
  discountPrice: 4.5,
  discountPct: 25,
  isFlashDeal: true,
  couponEligible: true,
  deliveryEligible: false,
  image: 'abc123.png',
  lastSeenAt: '2026-11-21T12:00:00Z',
  nearestBranch: null,
}
const ARROZ = {
  ...LEITE,
  id: 'd2',
  neighborhood: null,
  productName: 'Arroz Tio João 5kg',
  category: 'Mercearia',
  brand: null,
  unit: 'pacote',
  wholesaleMinQty: 6,
  originalPrice: null,
  discountPrice: 22.9,
  discountPct: null,
  isFlashDeal: false,
  couponEligible: false,
  deliveryEligible: true,
  image: null,
}
const amanha = new Date(Date.now() + 24 * 3600_000).toISOString()
const ontem = new Date(Date.now() - 24 * 3600_000).toISOString()
const CUPONS = [
  { id: 'c1', code: 'ABCD2345', status: 'ACTIVE', productName: 'Leite Integral Betânia 1L', unitPrice: 4.5, originalPrice: 6, profit: 1.5, minQty: 1, chain: { slug: 'sao-luiz', name: 'Mercadinhos São Luiz' }, neighborhood: 'Aldeota', createdAt: ontem, expiresAt: amanha, redeemedAt: null },
  { id: 'c2', code: 'WXYZ6789', status: 'REDEEMED', productName: 'Arroz Tio João 5kg', unitPrice: 20, originalPrice: 25, profit: 30, minQty: 6, chain: { slug: 'sao-luiz', name: 'Mercadinhos São Luiz' }, neighborhood: null, createdAt: ontem, expiresAt: amanha, redeemedAt: ontem },
  // ACTIVE já vencido: a API só marca EXPIRED depois; a ferramenta precisa tratar como vencido.
  { id: 'c3', code: 'KKKK2222', status: 'ACTIVE', productName: 'Café 500g', unitPrice: 10, originalPrice: 12, profit: 2, minQty: 1, chain: { slug: 'sao-luiz', name: 'Mercadinhos São Luiz' }, neighborhood: null, createdAt: ontem, expiresAt: ontem, redeemedAt: null },
]

interface Chamada {
  method: string
  path: string
  query?: Record<string, unknown>
}
let chamadas: Chamada[]
let dealsResposta: () => unknown
let cuponsResposta: () => unknown
let mcp: Client

function clienteFalso(): ApiClient {
  return {
    async request(method: string, path: string, opts?: { query?: Record<string, unknown> }) {
      chamadas.push({ method, path, query: opts?.query })
      if (method === 'GET' && path === '/deals/chains') return REDES as any
      if (method === 'GET' && path === '/deals') return dealsResposta() as any
      if (method === 'GET' && path === '/coupons/mine') return cuponsResposta() as any
      throw new ApiError(404, 'ROUTE_NOT_FOUND', `sem rota ${path}`)
    },
  }
}

interface ToolOut {
  isError?: boolean
  text: string
  data: any
}
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolOut> {
  const r = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: any }
  return { isError: r.isError, text: r.content.map((c) => c.text).join('\n'), data: r.structuredContent }
}

beforeEach(async () => {
  chamadas = []
  dealsResposta = () => [LEITE, ARROZ]
  cuponsResposta = () => CUPONS
  await mcp?.close()
  const server = new McpServer({ name: 'teste-ofertas-bairro', version: '0.0.0' })
  registerOfertasBairroTools(server, clienteFalso())
  const [a, b] = InMemoryTransport.createLinkedPair()
  mcp = new Client({ name: 'teste', version: '0.0.0' })
  await Promise.all([server.connect(a), mcp.connect(b)])
})

describe('listar_ofertas_do_bairro', () => {
  it('lista as ofertas com preço de/por, desconto e marcas', async () => {
    const r = await call('listar_ofertas_do_bairro')
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.total, 2)
    const leite = r.data.ofertas[0]
    assert.equal(leite.produto, 'Leite Integral Betânia 1L')
    assert.equal(leite.precoOriginal, 6)
    assert.equal(leite.descontoPct, 25)
    assert.equal(leite.geraCupom, true)
    assert.equal(leite.relampago, true)
    assert.equal(leite.foto, '/img/abc123.png')
    const arroz = r.data.ofertas[1]
    assert.equal(arroz.foto, null)
    assert.equal(arroz.bairro, null)
    assert.equal(arroz.quantidadeMinimaAtacado, 6)
    assert.equal(arroz.entregaPorMoto, true)
    assert.match(r.text, /R\$ 6,00 por R\$ 4,50 \(-25%\)/)
    assert.match(r.text, /rede toda/)
    assert.match(r.text, /a partir de 6 un\./)
  })

  it('manda os filtros para GET /deals (limite padrão 20) e resolve a rede por nome', async () => {
    await call('listar_ofertas_do_bairro', { busca: 'leite', bairro: 'Aldeota', rede: 'são luiz', categoria: 'Laticínios e Ovos', apenasCupom: true, apenasRelampago: true })
    const c = chamadas.find((x) => x.path === '/deals')!
    assert.deepEqual(c.query, { search: 'leite', neighborhood: 'Aldeota', chain: 'sao-luiz', category: 'Laticínios e Ovos', couponEligible: true, flash: true, limit: 20 })
  })

  it('sem filtros não manda filtro nenhum e nem consulta as redes', async () => {
    await call('listar_ofertas_do_bairro', { limite: 5 })
    assert.ok(!chamadas.some((x) => x.path === '/deals/chains'))
    assert.deepEqual(chamadas.find((x) => x.path === '/deals')!.query, {
      search: undefined,
      neighborhood: undefined,
      chain: undefined,
      category: undefined,
      couponEligible: undefined,
      flash: undefined,
      limit: 5,
    })
  })

  it('apenasCupom=false não filtra', async () => {
    await call('listar_ofertas_do_bairro', { apenasCupom: false })
    assert.equal(chamadas.find((x) => x.path === '/deals')!.query!.couponEligible, undefined)
  })

  it('vitrine vazia explica o motivo provável', async () => {
    dealsResposta = () => []
    const r = await call('listar_ofertas_do_bairro', { busca: 'xyz' })
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.total, 0)
    assert.match(r.text, /24 h/)
  })

  it('avisa quando bate o limite', async () => {
    const r = await call('listar_ofertas_do_bairro', { limite: 2 })
    assert.match(r.text, /limite de 2 atingido/)
  })

  it('rede ambígua ou inexistente vira erro com as opções, sem chamar /deals', async () => {
    const amb = await call('listar_ofertas_do_bairro', { rede: 'extra' })
    assert.equal(amb.isError, true)
    assert.match(amb.text, /Extra São José/)
    assert.match(amb.text, /Extra São Paulo/)
    const nada = await call('listar_ofertas_do_bairro', { rede: 'carrefour' })
    assert.equal(nada.isError, true)
    assert.match(nada.text, /Não encontrei a rede/)
    assert.ok(!chamadas.some((x) => x.path === '/deals'))
  })

  it('valida categoria e limite', async () => {
    assert.equal((await call('listar_ofertas_do_bairro', { categoria: 'Eletrônicos' })).isError, true)
    assert.equal((await call('listar_ofertas_do_bairro', { limite: 0 })).isError, true)
    assert.equal((await call('listar_ofertas_do_bairro', { limite: 51 })).isError, true)
  })

  it('erro da API volta como resultado de erro da tool', async () => {
    dealsResposta = () => {
      throw new ApiError(400, 'VALIDATION_ERROR', 'filtro inválido')
    }
    const r = await call('listar_ofertas_do_bairro')
    assert.equal(r.isError, true)
    assert.match(r.text, /VALIDATION_ERROR/)
  })
})

describe('listar_meus_cupons', () => {
  it('traduz o status, marca o ativo vencido como vencido e nunca expõe o lucro', async () => {
    const r = await call('listar_meus_cupons')
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.total, 3)
    const por = Object.fromEntries(r.data.cupons.map((c: any) => [c.codigo, c]))
    assert.equal(por.ABCD2345.status, 'ativo')
    assert.equal(por.WXYZ6789.status, 'compra confirmada')
    assert.equal(por.KKKK2222.status, 'vencido')
    assert.equal(por.WXYZ6789.economia, 30)
    assert.ok(!JSON.stringify(r.data).includes('profit'), 'profit não pode vazar')
    assert.ok(!/lucro/i.test(r.text))
    assert.match(r.text, /economizou R\$ 30,00/)
  })

  it('filtra por status', async () => {
    const ativos = await call('listar_meus_cupons', { status: 'ativo' })
    assert.deepEqual(ativos.data.cupons.map((c: any) => c.codigo), ['ABCD2345'])
    const vencidos = await call('listar_meus_cupons', { status: 'vencido' })
    assert.deepEqual(vencidos.data.cupons.map((c: any) => c.codigo), ['KKKK2222'])
    assert.equal((await call('listar_meus_cupons', { status: 'qualquer' })).isError, true)
  })

  it('conta sem cupons explica o que é cupom em vez de dar erro', async () => {
    cuponsResposta = () => []
    const r = await call('listar_meus_cupons')
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.total, 0)
    assert.match(r.text, /15%/)
  })

  it('401 da API vira erro da tool', async () => {
    cuponsResposta = () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Faça login.')
    }
    const r = await call('listar_meus_cupons')
    assert.equal(r.isError, true)
    assert.match(r.text, /UNAUTHENTICATED/)
  })
})
