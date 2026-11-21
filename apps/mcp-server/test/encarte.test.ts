import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ApiError, type ApiClient } from '../src/api-client.js'
import { normalizar, registerEncarteTools, resolverRede } from '../src/tools-encarte.js'

const REDES = [
  { id: 1, slug: 'sao-luiz', name: 'Mercadinhos São Luiz', kind: 'SUPERMARKET', dealCount: 10 },
  { id: 2, slug: 'pague-menos', name: 'Pague Menos', kind: 'PHARMACY', dealCount: 3 },
  { id: 3, slug: 'extra-sao-jose', name: 'Extra São José', kind: 'SUPERMARKET', dealCount: 4 },
  { id: 4, slug: 'extra-sao-paulo', name: 'Extra São Paulo', kind: 'SUPERMARKET', dealCount: 2 },
]
const FILIAIS = ['Aldeota', 'Meireles', 'Centro', 'Benfica', 'Messejana', 'Cocó', 'Papicu'].map((b, i) => ({
  id: i + 1,
  name: `São Luiz ${b}`,
  address: 'Rua X',
  neighborhood: b,
  latitude: -3.7,
  longitude: -38.5,
}))

interface Chamada {
  method: string
  path: string
  body?: any
}
let chamadas: Chamada[]
let postResposta: () => unknown
let mcp: Client

function clienteFalso(): ApiClient {
  return {
    async request(method: string, path: string, opts?: { body?: unknown }) {
      chamadas.push({ method, path, body: opts?.body })
      if (method === 'GET' && path === '/deals/chains') return REDES as any
      if (method === 'GET' && path === '/deals/chains/sao-luiz/branches') return FILIAIS as any
      if (method === 'POST' && path === '/deals/flyers/structured') return postResposta() as any
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

const oferta = { produto: 'Leite Integral Betânia 1L', categoria: 'Laticínios e Ovos', unidade: 'un', precoPor: 4.99 }

beforeEach(async () => {
  chamadas = []
  postResposta = () => ({ id: 'f1', chain: 'sao-luiz', status: 'SUCCESS', itemsExtracted: 1, itemsDropped: 0 })
  await mcp?.close()
  const server = new McpServer({ name: 'teste-encarte', version: '0.0.0' })
  registerEncarteTools(server, clienteFalso())
  const [a, b] = InMemoryTransport.createLinkedPair()
  mcp = new Client({ name: 'teste', version: '0.0.0' })
  await Promise.all([server.connect(a), mcp.connect(b)])
})

describe('resolução de rede', () => {
  it('normaliza acento, caixa e pontuação', () => {
    assert.equal(normalizar('  São   LUIZ! '), 'sao luiz')
  })
  it('acha por nome parcial sem acento, por slug e por nome exato', () => {
    assert.deepEqual(resolverRede(REDES, 'sao luiz'), { tipo: 'unica', rede: REDES[0] })
    assert.deepEqual(resolverRede(REDES, 'MERCADINHO São Luiz'), { tipo: 'unica', rede: REDES[0] })
    assert.deepEqual(resolverRede(REDES, 'pague-menos'), { tipo: 'unica', rede: REDES[1] })
  })
  it('ambígua e inexistente', () => {
    const amb = resolverRede(REDES, 'extra')
    assert.equal(amb.tipo, 'ambigua')
    assert.equal(resolverRede(REDES, 'carrefour').tipo, 'nenhuma')
  })
})

describe('consultar_rede', () => {
  it('devolve slug, filiais ativas e só as 5 primeiras', async () => {
    const r = await call('consultar_rede', { busca: 'são luiz' })
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.rede.slug, 'sao-luiz')
    assert.equal(r.data.rede.filiaisAtivas, 7)
    assert.equal(r.data.rede.primeirasFiliais.length, 5)
    assert.deepEqual(r.data.rede.primeirasFiliais[0], { nome: 'São Luiz Aldeota', bairro: 'Aldeota' })
    assert.match(r.text, /7 filial/)
  })
  it('sem acento funciona igual', async () => {
    const r = await call('consultar_rede', { busca: 'SAO LUIZ' })
    assert.equal(r.data.rede.slug, 'sao-luiz')
  })
  it('ambígua lista as opções e não busca filiais', async () => {
    const r = await call('consultar_rede', { busca: 'extra' })
    assert.ok(!r.isError)
    assert.equal(r.data.ambigua, true)
    assert.equal(r.data.redes.length, 2)
    assert.match(r.text, /qual é/)
    assert.ok(!chamadas.some((c) => c.path.includes('branches')))
  })
  it('inexistente lista as redes disponíveis', async () => {
    const r = await call('consultar_rede', { busca: 'carrefour' })
    assert.ok(!r.isError)
    assert.equal(r.data.encontrada, false)
    assert.equal(r.data.redes.length, REDES.length)
    assert.match(r.text, /Pague Menos \(slug: pague-menos\)/)
  })
})

describe('cadastrar_ofertas_encarte', () => {
  it('mapeia português para o corpo da API (campos opcionais só quando informados)', async () => {
    const r = await call('cadastrar_ofertas_encarte', {
      rede: 'mercadinhos sao luiz',
      bairro: 'Aldeota',
      validadeDias: 10,
      nomeArquivo: 'panfleto.pdf',
      ofertas: [
        oferta,
        { produto: 'Arroz Tio João 5kg', categoria: 'Mercearia', marca: 'Tio João', unidade: 'pacote', quantidadeMinimaAtacado: 3, precoDe: 30, precoPor: 24.9, relampago: true, entregaPorMoto: false, textoOriginal: 'ARROZ 5KG' },
      ],
    })
    assert.ok(!r.isError, r.text)
    const post = chamadas.find((c) => c.method === 'POST')!
    assert.deepEqual(post.body, {
      chain: 'sao-luiz',
      neighborhood: 'Aldeota',
      validDays: 10,
      fileName: 'panfleto.pdf',
      deals: [
        { productName: 'Leite Integral Betânia 1L', category: 'Laticínios e Ovos', unit: 'un', discountPrice: 4.99 },
        {
          productName: 'Arroz Tio João 5kg',
          category: 'Mercearia',
          brand: 'Tio João',
          unit: 'pacote',
          wholesaleMinQty: 3,
          originalPrice: 30,
          discountPrice: 24.9,
          isFlashDeal: true,
          deliveryEligible: false,
          rawOfferText: 'ARROZ 5KG',
        },
      ],
    })
    assert.equal('append' in post.body, false)
    assert.match(r.text, /substituindo o encarte anterior/)
    assert.match(r.text, /filial mais próxima/)
  })

  it('adicionar=true vira append=true', async () => {
    const r = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', adicionar: true, ofertas: [oferta] })
    assert.ok(!r.isError, r.text)
    assert.equal(chamadas.find((c) => c.method === 'POST')!.body.append, true)
    assert.match(r.text, /somadas às páginas anteriores/)
  })

  it('mostra as ofertas descartadas e o motivo', async () => {
    postResposta = () => ({
      id: 'f2',
      status: 'SUCCESS',
      itemsExtracted: 1,
      itemsDropped: 1,
      dropped: [{ index: 1, productName: 'Coisa Estranha', reason: 'Desconto implausível (>90%).' }],
    })
    const r = await call('cadastrar_ofertas_encarte', { rede: 'sao luiz', ofertas: [oferta, { ...oferta, produto: 'Coisa Estranha' }] })
    assert.ok(!r.isError, r.text)
    assert.equal(r.data.cadastradas, 1)
    assert.equal(r.data.descartadas, 1)
    assert.match(r.text, /1 oferta\(s\) cadastrada\(s\) e 1 descartada\(s\)/)
    assert.match(r.text, /Oferta 2 \(Coisa Estranha\): Desconto implausível/)
    assert.equal(r.data.detalheDescartadas[0].index, 1)
  })

  it('rede ambígua ou inexistente vira erro claro, sem chamar a API de envio', async () => {
    const amb = await call('cadastrar_ofertas_encarte', { rede: 'extra', ofertas: [oferta] })
    assert.ok(amb.isError)
    assert.match(amb.text, /Extra São José/)
    assert.match(amb.text, /Extra São Paulo/)
    const nada = await call('cadastrar_ofertas_encarte', { rede: 'carrefour', ofertas: [oferta] })
    assert.ok(nada.isError)
    assert.match(nada.text, /Não encontrei a rede/)
    assert.match(nada.text, /Pague Menos/)
    assert.ok(!chamadas.some((c) => c.method === 'POST'))
  })

  it('403 NOT_CHAIN_MANAGER explica que precisa ser gerente da rede', async () => {
    postResposta = () => {
      throw new ApiError(403, 'NOT_CHAIN_MANAGER', 'Você não está autorizado a enviar encartes desta rede.')
    }
    const r = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', ofertas: [oferta] })
    assert.ok(r.isError)
    assert.match(r.text, /gerente desta rede/)
  })

  it('422 NO_VALID_DEALS lista os motivos', async () => {
    postResposta = () => {
      throw new ApiError(422, 'NO_VALID_DEALS', 'Nenhuma das ofertas enviadas é válida.', { dropped: [{ index: 0, productName: 'Leite', reason: 'Preço promocional maior que o original.' }] })
    }
    const r = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', ofertas: [oferta] })
    assert.ok(r.isError)
    assert.match(r.text, /Nenhuma das ofertas enviadas era válida/)
    assert.match(r.text, /Oferta 1 \(Leite\): Preço promocional maior/)
  })

  it('404 CHAIN_NOT_FOUND e outros erros da API viram mensagem', async () => {
    postResposta = () => {
      throw new ApiError(404, 'CHAIN_NOT_FOUND', 'Rede não encontrada.')
    }
    const a = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', ofertas: [oferta] })
    assert.ok(a.isError)
    assert.match(a.text, /consultar_rede/)
    postResposta = () => {
      throw new ApiError(500, 'INTERNAL', 'falhou')
    }
    const b = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', ofertas: [oferta] })
    assert.ok(b.isError)
    assert.match(b.text, /A API recusou o pedido: \[INTERNAL\]/)
  })

  it('valida entrada: categoria fora da lista e lista vazia', async () => {
    const cat = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', ofertas: [{ ...oferta, categoria: 'Eletrônicos' }] })
    assert.ok(cat.isError)
    const vazia = await call('cadastrar_ofertas_encarte', { rede: 'sao-luiz', ofertas: [] })
    assert.ok(vazia.isError)
    assert.ok(!chamadas.some((c) => c.method === 'POST'))
  })
})
