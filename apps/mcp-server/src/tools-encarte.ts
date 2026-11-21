import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ApiError, type ApiClient } from './api-client.js'

// Ferramentas do panfleto/encarte: o Claude do chat lê a imagem/PDF e manda as ofertas JÁ ESTRUTURADAS.
// O servidor não faz OCR nem usa chave de IA: só valida, mapeia para a API e conta o que foi aceito/descartado.

class ToolError extends Error {}

const CATEGORIAS = ['Laticínios e Ovos', 'Hortifrúti', 'Açougue e Peixaria', 'Padaria e Matinais', 'Mercearia', 'Bebidas', 'Higiene e Beleza', 'Limpeza', 'Pet Shop'] as const
const UNIDADES = ['un', 'kg', 'g', 'l', 'ml', 'pacote', 'bandeja'] as const

interface Rede {
  id: number | string
  slug: string
  name: string
  kind?: string
  dealCount?: number
}
interface Filial {
  id: number | string
  name: string
  address?: string | null
  neighborhood?: string | null
  latitude?: number | null
  longitude?: number | null
}
interface Descartada {
  index: number
  productName: string
  reason: string
}
interface EnvioDTO {
  id: number | string
  chain?: unknown
  status?: string
  itemsExtracted: number
  itemsDropped?: number
  dropped?: Descartada[]
  [k: string]: unknown
}

function ok(text: string, data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: `${text}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data }
}
function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Mesma ideia do run() do server.ts, com mensagens próprias para os erros do encarte. */
async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404 && err.code === 'ROUTE_NOT_FOUND') return fail('Esta operação ainda não existe na API do VizinhoHub (rota não encontrada). Atualize/reinicie a API.')
      if (err.code === 'NOT_CHAIN_MANAGER') return fail('Você não está autorizado como gerente desta rede, então não pode enviar o encarte dela. Peça à equipe do VizinhoHub para vincular sua conta à rede e tente de novo.')
      if (err.code === 'CHAIN_NOT_FOUND') return fail('A rede informada não existe no VizinhoHub. Use consultar_rede para ver as redes disponíveis.')
      if (err.code === 'NO_VALID_DEALS') {
        const dropped = (err.details as { dropped?: Descartada[] } | undefined)?.dropped
        const motivos = Array.isArray(dropped) && dropped.length ? '\n' + dropped.map(linhaDescartada).join('\n') : ''
        return fail(`Nenhuma das ofertas enviadas era válida, então nada foi cadastrado.${motivos}\nCorrija os itens (preço promocional claro, categoria e unidade da lista) e envie de novo.`)
      }
      return fail(`A API recusou o pedido: ${err.describe()}`)
    }
    if (err instanceof ToolError) return fail(err.message)
    return fail(`Erro inesperado: ${(err as Error).message}`)
  }
}

const linhaDescartada = (d: Descartada) => `- Oferta ${d.index + 1} (${d.productName}): ${d.reason}`

/** Minúsculas, sem acento e com espaços normalizados, para comparar nomes de rede. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type Resolucao = { tipo: 'unica'; rede: Rede } | { tipo: 'ambigua'; redes: Rede[] } | { tipo: 'nenhuma' }

/** Acha a rede por slug ou nome (sem acento/caixa): exato primeiro, depois todas as palavras contidas. */
export function resolverRede(redes: Rede[], busca: string): Resolucao {
  const q = normalizar(busca)
  if (!q) return { tipo: 'nenhuma' }
  const exatas = redes.filter((r) => normalizar(r.slug) === q || normalizar(r.name) === q)
  if (exatas.length === 1) return { tipo: 'unica', rede: exatas[0]! }
  if (exatas.length > 1) return { tipo: 'ambigua', redes: exatas }
  const palavras = q.split(' ')
  const parciais = redes.filter((r) => {
    const alvo = `${normalizar(r.name)} ${normalizar(r.slug)}`
    return palavras.every((p) => alvo.includes(p))
  })
  if (parciais.length === 1) return { tipo: 'unica', rede: parciais[0]! }
  if (parciais.length > 1) return { tipo: 'ambigua', redes: parciais }
  return { tipo: 'nenhuma' }
}

const listaRedes = (redes: Rede[]) => redes.map((r) => `- ${r.name} (slug: ${r.slug})`).join('\n')
const resumoRede = (r: Rede) => ({ slug: r.slug, nome: r.name })

async function carregarRedes(client: ApiClient): Promise<Rede[]> {
  return client.request<Rede[]>('GET', '/deals/chains')
}

export function registerEncarteTools(server: McpServer, client: ApiClient): void {
  // 1. consultar_rede ------------------------------------------------------------------------------
  server.registerTool(
    'consultar_rede',
    {
      title: 'Consultar rede de mercados',
      description:
        'Procura uma rede de mercados monitorada pelo VizinhoHub (ex.: "são luiz") pelo nome ou slug, sem se importar com acento ou maiúsculas. ' +
        'Devolve o slug, o nome, a quantidade de filiais ativas e as 5 primeiras filiais (nome e bairro). ' +
        'Use ANTES de cadastrar_ofertas_encarte para confirmar com o usuário de qual rede é o panfleto. ' +
        'Se várias redes casarem, mostre as opções e peça para o usuário escolher; se nenhuma casar, mostre as redes disponíveis. Nunca invente uma rede.',
      inputSchema: { busca: z.string().trim().min(1).max(100).describe('Nome (ou parte do nome) da rede, ex.: "são luiz", "Mercadinhos São Luiz".') },
      annotations: { readOnlyHint: true },
    },
    ({ busca }) =>
      run(async () => {
        const redes = await carregarRedes(client)
        const r = resolverRede(redes, busca)
        if (r.tipo === 'ambigua') {
          return ok(`Várias redes combinam com "${busca}". Pergunte ao usuário qual é:\n${listaRedes(r.redes)}`, { redes: r.redes.map(resumoRede), ambigua: true })
        }
        if (r.tipo === 'nenhuma') {
          return ok(
            redes.length ? `Nenhuma rede encontrada para "${busca}". Redes disponíveis (não invente outra):\n${listaRedes(redes)}` : `Nenhuma rede encontrada para "${busca}" e não há redes cadastradas.`,
            { redes: redes.map(resumoRede), encontrada: false },
          )
        }
        const filiais = await client.request<Filial[]>('GET', `/deals/chains/${encodeURIComponent(r.rede.slug)}/branches`)
        const primeiras = filiais.slice(0, 5).map((f) => ({ nome: f.name, bairro: f.neighborhood ?? null }))
        const texto =
          `Rede: ${r.rede.name} (slug: ${r.rede.slug}) com ${filiais.length} filial(is) ativa(s).` +
          (primeiras.length ? '\nPrimeiras filiais:\n' + primeiras.map((f) => `- ${f.nome}${f.bairro ? ` (${f.bairro})` : ''}`).join('\n') : '')
        return ok(texto, { rede: { slug: r.rede.slug, nome: r.rede.name, filiaisAtivas: filiais.length, primeirasFiliais: primeiras } })
      }),
  )

  // 2. cadastrar_ofertas_encarte -------------------------------------------------------------------
  server.registerTool(
    'cadastrar_ofertas_encarte',
    {
      title: 'Cadastrar ofertas do panfleto',
      description:
        'Cadastra no VizinhoHub as ofertas de um panfleto/encarte de uma rede de mercados. Você (Claude) lê o panfleto anexado e envia aqui as ofertas já estruturadas; o servidor não faz OCR.\n' +
        'Como proceder:\n' +
        '1) Leia o panfleto anexado com atenção e extraia SÓ itens com desconto ou preço promocional claro (ignore preço normal, sem promoção).\n' +
        '2) Não invente preços nem itens ilegíveis. Se algo estiver ilegível ou duvidoso, deixe o item de fora e avise o usuário.\n' +
        '3) Normalize os nomes ("Leite Integral Betânia 1L") e tire slogans e textos de marketing. Preços em reais (número, ex.: 4.99). Categoria e unidade devem ser exatamente um dos valores permitidos.\n' +
        '4) Panfleto de várias páginas: chame esta ferramenta uma vez por página, com adicionar=true a partir da segunda (senão as ofertas das páginas anteriores são substituídas).\n' +
        '5) Se houver dúvida sobre a rede, use consultar_rede antes e confirme com o usuário. Informe bairro só se o panfleto for de UMA filial específica; sem bairro vale para a rede toda.\n' +
        'Atacarejo ("a partir de N un"): use quantidadeMinimaAtacado. Só quem é gerente da rede pode enviar. Máximo 200 ofertas por chamada.',
      inputSchema: {
        rede: z.string().trim().min(1).max(100).describe('Slug ou nome da rede (ex.: "Mercadinhos São Luiz"). Se ambíguo ou inexistente, a ferramenta devolve erro com as opções.'),
        bairro: z.string().trim().min(1).max(80).optional().describe('Só se o panfleto for de UMA filial específica (bairro dela). Sem bairro, vale para a rede toda.'),
        validadeDias: z.number().int().min(1).max(30).optional().describe('Validade do encarte em dias (1 a 30; padrão 7).'),
        adicionar: z.boolean().optional().describe('true = este arquivo é mais uma página do mesmo encarte (não apaga as ofertas anteriores). Padrão false = substitui o encarte anterior da rede/bairro.'),
        nomeArquivo: z.string().trim().max(200).optional().describe('Nome do arquivo do panfleto, se souber.'),
        ofertas: z
          .array(
            z.object({
              produto: z.string().trim().min(2).max(200).describe('Nome normalizado do produto, ex.: "Leite Integral Betânia 1L".'),
              categoria: z.enum(CATEGORIAS).describe('Categoria (valor exato da lista).'),
              marca: z.string().trim().min(1).max(80).optional().describe('Marca, se aparecer.'),
              unidade: z.enum(UNIDADES).describe('Unidade de venda do preço (valor exato da lista).'),
              quantidadeMinimaAtacado: z.number().int().min(1).max(999).optional().describe('Atacarejo: o preço vale a partir de N unidades.'),
              precoDe: z.number().positive().max(100_000).optional().describe('Preço antigo (R$), se o panfleto mostrar.'),
              precoPor: z.number().positive().max(100_000).describe('Preço promocional (R$). Obrigatório.'),
              relampago: z.boolean().optional().describe('true se o panfleto marcar como oferta relâmpago / só hoje.'),
              entregaPorMoto: z.boolean().optional().describe('true se o panfleto indicar entrega por moto para esta oferta.'),
              textoOriginal: z.string().trim().max(500).optional().describe('Trecho curto do panfleto que originou a oferta.'),
            }),
          )
          .min(1)
          .max(200)
          .describe('Ofertas extraídas do panfleto (1 a 200 por chamada).'),
      },
    },
    (a) =>
      run(async () => {
        const redes = await carregarRedes(client)
        const r = resolverRede(redes, a.rede)
        if (r.tipo === 'ambigua') throw new ToolError(`Mais de uma rede combina com "${a.rede}". Pergunte ao usuário qual é e chame de novo com o slug:\n${listaRedes(r.redes)}`)
        if (r.tipo === 'nenhuma') {
          throw new ToolError(`Não encontrei a rede "${a.rede}". Não invente: confirme com o usuário. ${redes.length ? `Redes disponíveis:\n${listaRedes(redes)}` : 'Não há redes cadastradas.'} Use consultar_rede para conferir.`)
        }
        const body = {
          chain: r.rede.slug,
          ...(a.bairro !== undefined && { neighborhood: a.bairro }),
          ...(a.validadeDias !== undefined && { validDays: a.validadeDias }),
          ...(a.adicionar !== undefined && { append: a.adicionar }),
          ...(a.nomeArquivo !== undefined && { fileName: a.nomeArquivo }),
          deals: a.ofertas.map((o) => ({
            productName: o.produto,
            category: o.categoria,
            ...(o.marca !== undefined && { brand: o.marca }),
            unit: o.unidade,
            ...(o.quantidadeMinimaAtacado !== undefined && { wholesaleMinQty: o.quantidadeMinimaAtacado }),
            ...(o.precoDe !== undefined && { originalPrice: o.precoDe }),
            discountPrice: o.precoPor,
            ...(o.relampago !== undefined && { isFlashDeal: o.relampago }),
            ...(o.entregaPorMoto !== undefined && { deliveryEligible: o.entregaPorMoto }),
            ...(o.textoOriginal !== undefined && { rawOfferText: o.textoOriginal }),
          })),
        }
        const envio = await client.request<EnvioDTO>('POST', '/deals/flyers/structured', { body })
        const descartadas = envio.dropped ?? []
        const cadastradas = envio.itemsExtracted
        const totalDescartadas = Math.max(envio.itemsDropped ?? 0, descartadas.length)
        const texto =
          `Encarte de ${r.rede.name}${a.bairro ? ` (${a.bairro})` : ''} recebido: ${cadastradas} oferta(s) cadastrada(s) e ${totalDescartadas} descartada(s)` +
          `${a.adicionar ? ', somadas às páginas anteriores' : ', substituindo o encarte anterior'}.` +
          (descartadas.length ? `\nDescartadas:\n${descartadas.map(linhaDescartada).join('\n')}\nAvise o usuário sobre elas.` : '') +
          '\nAgora o site mostra cada oferta com a filial mais próxima do cliente, a distância e o tempo até lá.'
        return ok(texto, { rede: resumoRede(r.rede), envio, cadastradas, descartadas: totalDescartadas, detalheDescartadas: descartadas })
      }),
  )
}
