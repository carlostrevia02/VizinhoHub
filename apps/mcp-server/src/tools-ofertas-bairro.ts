import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ApiError, type ApiClient } from './api-client.js'
import { resolverRede } from './tools-encarte.js'

// Ferramentas SÓ DE LEITURA das "Ofertas do Bairro" (vitrine dos supermercados + cupom de retirada).
// Servem para o chat explicar e conferir a função; quem cadastra ofertas de rede é cadastrar_ofertas_encarte.

class ToolError extends Error {}

const CATEGORIAS = ['Laticínios e Ovos', 'Hortifrúti', 'Açougue e Peixaria', 'Padaria e Matinais', 'Mercearia', 'Bebidas', 'Higiene e Beleza', 'Limpeza', 'Pet Shop'] as const

interface Rede {
  id: number | string
  slug: string
  name: string
  dealCount?: number
}
interface Oferta {
  id: string
  chain: { slug: string; name: string }
  neighborhood: string | null
  productName: string
  category: string
  brand: string | null
  unit: string
  wholesaleMinQty: number
  originalPrice: number | null
  discountPrice: number
  discountPct: number | null
  isFlashDeal: boolean
  couponEligible: boolean
  deliveryEligible: boolean
  image?: string | null // arquivo em /img do site: foto do produto de nome mais parecido no catálogo (aproximação)
  lastSeenAt: string
}
interface Cupom {
  id: string
  code: string
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED'
  productName: string
  unitPrice: number
  originalPrice: number
  minQty: number
  chain: { slug: string; name: string }
  neighborhood: string | null
  createdAt: string
  expiresAt: string
  redeemedAt: string | null
}

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function ok(text: string, data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: `${text}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data }
}
function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404 && err.code === 'ROUTE_NOT_FOUND') return fail('Esta operação ainda não existe na API do VizinhoHub (rota não encontrada). Atualize/reinicie a API.')
      return fail(`A API recusou o pedido: ${err.describe()}`)
    }
    if (err instanceof ToolError) return fail(err.message)
    return fail(`Erro inesperado: ${(err as Error).message}`)
  }
}

const listaRedes = (redes: Rede[]) => redes.map((r) => `- ${r.name} (slug: ${r.slug})`).join('\n')

function linhaOferta(o: Oferta): string {
  const preco = o.originalPrice !== null ? `${brl(o.originalPrice)} por ${brl(o.discountPrice)}${o.discountPct !== null ? ` (-${o.discountPct}%)` : ''}` : brl(o.discountPrice)
  const qtd = o.wholesaleMinQty > 1 ? `, a partir de ${o.wholesaleMinQty} un.` : ''
  const marcas = [o.isFlashDeal && 'relâmpago', o.couponEligible && 'cupom', o.deliveryEligible && 'entrega por moto'].filter(Boolean).join(', ')
  return `- [${o.chain.name}] ${o.productName}${o.brand ? ` (${o.brand})` : ''} | ${preco}/${o.unit}${qtd} | ${o.neighborhood ?? 'rede toda'}${marcas ? ` | ${marcas}` : ''} | id ${o.id}`
}

const STATUS_CUPOM = { ACTIVE: 'ativo', REDEEMED: 'compra confirmada', EXPIRED: 'vencido' } as const

// O lucro do VizinhoHub (`profit`) nunca sai daqui: o site também não o mostra ao cliente.
function cupomView(c: Cupom, agora = new Date()) {
  const vencido = c.status === 'EXPIRED' || (c.status === 'ACTIVE' && new Date(c.expiresAt) <= agora)
  const status = vencido ? 'EXPIRED' : c.status
  return {
    id: c.id,
    codigo: c.code,
    status: STATUS_CUPOM[status],
    produto: c.productName,
    precoReservado: c.unitPrice,
    precoOriginal: c.originalPrice,
    quantidadeMinima: c.minQty,
    economia: Math.max(0, (c.originalPrice - c.unitPrice) * c.minQty),
    rede: c.chain.name,
    redeSlug: c.chain.slug,
    bairro: c.neighborhood,
    validoAte: c.expiresAt,
    validoAteFortaleza: dataHora(c.expiresAt),
    compraConfirmadaEm: c.redeemedAt,
  }
}

export function registerOfertasBairroTools(server: McpServer, client: ApiClient): void {
  // 1. listar_ofertas_do_bairro --------------------------------------------------------------------
  server.registerTool(
    'listar_ofertas_do_bairro',
    {
      title: 'Listar ofertas do bairro',
      description:
        'Lista as "Ofertas do Bairro": promoções dos supermercados e atacarejos monitorados pelo VizinhoHub (não são as ofertas da loja do lojista; para essas use listar_minhas_ofertas). ' +
        'É a mesma vitrine que o cliente vê no site em /ofertas-do-bairro, com o maior desconto primeiro. Só vale o que foi visto nas últimas 24 h. ' +
        'Cada oferta traz rede, produto, preço de/por, % de desconto, unidade, bairro (vazio = vale para a rede toda) e se é relâmpago, se gera cupom de retirada (desconto de pelo menos 15%) ou se tem entrega por moto. ' +
        'O campo "foto" é o caminho da imagem no site (/img/...), tirada do produto de nome mais parecido no catálogo: é uma aproximação, pode ser de outra marca; null = sem foto. ' +
        'Todos os filtros são opcionais. "rede" aceita nome ou slug (ex.: "são luiz"). Use para explicar a função, conferir se um encarte cadastrado apareceu ou responder "o que está em oferta no bairro X".',
      inputSchema: {
        busca: z.string().trim().min(1).max(100).optional().describe('Parte do nome do produto, ex.: "leite", "arroz".'),
        bairro: z.string().trim().min(1).max(80).optional().describe('Bairro, ex.: "Aldeota". Inclui também as ofertas da rede toda (sem bairro).'),
        rede: z.string().trim().min(1).max(100).optional().describe('Nome ou slug da rede, ex.: "são luiz". Veja as redes com consultar_rede.'),
        categoria: z.enum(CATEGORIAS).optional().describe('Categoria (valor exato da lista).'),
        apenasCupom: z.boolean().optional().describe('true = só ofertas que geram cupom de retirada (desconto de 15% ou mais).'),
        apenasRelampago: z.boolean().optional().describe('true = só ofertas relâmpago / só hoje.'),
        limite: z.number().int().min(1).max(50).optional().describe('Máximo de ofertas (1 a 50; padrão 20).'),
      },
      annotations: { readOnlyHint: true },
    },
    (a) =>
      run(async () => {
        let slug: string | undefined
        if (a.rede !== undefined) {
          const redes = await client.request<Rede[]>('GET', '/deals/chains')
          const r = resolverRede(redes, a.rede)
          if (r.tipo === 'ambigua') throw new ToolError(`Mais de uma rede combina com "${a.rede}". Pergunte ao usuário qual é e chame de novo com o slug:\n${listaRedes(r.redes)}`)
          if (r.tipo === 'nenhuma') {
            throw new ToolError(`Não encontrei a rede "${a.rede}". Não invente: confirme com o usuário. ${redes.length ? `Redes disponíveis:\n${listaRedes(redes)}` : 'Não há redes cadastradas.'}`)
          }
          slug = r.rede.slug
        }
        const limite = a.limite ?? 20
        const ofertas = await client.request<Oferta[]>('GET', '/deals', {
          query: {
            search: a.busca,
            neighborhood: a.bairro,
            chain: slug,
            category: a.categoria,
            couponEligible: a.apenasCupom ? true : undefined,
            flash: a.apenasRelampago ? true : undefined,
            limit: limite,
          },
        })
        const itens = ofertas.map((o) => ({
          id: o.id,
          rede: o.chain.name,
          redeSlug: o.chain.slug,
          bairro: o.neighborhood,
          produto: o.productName,
          marca: o.brand,
          categoria: o.category,
          unidade: o.unit,
          quantidadeMinimaAtacado: o.wholesaleMinQty > 1 ? o.wholesaleMinQty : null,
          precoOriginal: o.originalPrice,
          precoOferta: o.discountPrice,
          descontoPct: o.discountPct,
          relampago: o.isFlashDeal,
          geraCupom: o.couponEligible,
          entregaPorMoto: o.deliveryEligible,
          foto: o.image ? `/img/${o.image}` : null,
          vistaEm: o.lastSeenAt,
        }))
        if (itens.length === 0) {
          return ok('Nenhuma oferta do bairro encontrada com esses filtros. A vitrine só mostra o que foi visto nas últimas 24 h; se esperava ofertas, o encarte pode não ter sido cadastrado ou ter vencido.', { ofertas: itens, total: 0 })
        }
        const cheio = itens.length === limite ? ` (limite de ${limite} atingido; refine os filtros para ver outras)` : ''
        return ok(`${itens.length} oferta(s) do bairro${cheio}:\n${ofertas.map(linhaOferta).join('\n')}`, { ofertas: itens, total: itens.length })
      }),
  )

  // 2. listar_meus_cupons --------------------------------------------------------------------------
  server.registerTool(
    'listar_meus_cupons',
    {
      title: 'Listar meus cupons de retirada',
      description:
        'Lista os cupons de retirada das Ofertas do Bairro que a CONTA conectada reservou como cliente (não os cupons dos clientes da loja). ' +
        'O cupom é uma reserva de preço: o cliente leva o código ao caixa da rede, vale 24 h e só vira "compra confirmada" quando o cliente aperta "Confirmei minha compra" no site. ' +
        'Cada cupom traz código, produto, preço reservado e original, economia, rede, validade (também em horário de Fortaleza) e status (ativo, compra confirmada ou vencido). ' +
        'Esta ferramenta só lê: não cria nem confirma cupom. Conta sem cupons devolve lista vazia.',
      inputSchema: { status: z.enum(['ativo', 'compra_confirmada', 'vencido']).optional().describe('Filtra por status. Sem filtro, devolve todos.') },
      annotations: { readOnlyHint: true },
    },
    ({ status }) =>
      run(async () => {
        const cupons = (await client.request<Cupom[]>('GET', '/coupons/mine')).map((c) => cupomView(c))
        const alvo = status === undefined ? undefined : { ativo: 'ativo', compra_confirmada: 'compra confirmada', vencido: 'vencido' }[status]
        const lista = alvo ? cupons.filter((c) => c.status === alvo) : cupons
        if (lista.length === 0) {
          return ok(alvo ? `Nenhum cupom com status "${alvo}" nesta conta.` : 'Esta conta não tem cupons de retirada. Cupom nasce quando um cliente reserva uma oferta do bairro com desconto de 15% ou mais.', { cupons: [], total: 0 })
        }
        const linhas = lista.map(
          (c) =>
            `- ${c.codigo} | ${c.produto} | ${brl(c.precoReservado)}${c.quantidadeMinima > 1 ? ` (a partir de ${c.quantidadeMinima} un.)` : ''} | ${c.rede} | ${c.status}` +
            `${c.status === 'ativo' ? ` até ${c.validoAteFortaleza}` : ''}${c.status === 'compra confirmada' && c.economia > 0 ? ` | economizou ${brl(c.economia)}` : ''}`,
        )
        return ok(`${lista.length} cupom(ns):\n${linhas.join('\n')}`, { cupons: lista, total: lista.length })
      }),
  )
}
