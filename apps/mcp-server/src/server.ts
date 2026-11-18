import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { hhmm, isoDate, money, uuid } from '@vizinhohub/contracts/common'
import { createComboSchema, setDailyMenuSchema, type ComboDTO, type DailyMenuItemDTO } from '@vizinhohub/contracts/daily-menu'
import { createFlashSchema, type MerchantFlashDTO } from '@vizinhohub/contracts/flash'
import type { MerchantProductDTO } from '@vizinhohub/contracts/products'
import { z } from 'zod'
import { ApiError, type ApiClient } from './api-client.js'
import { fortalezaDate, formatFortaleza, TimeError, untilToday } from './time.js'

class ToolError extends Error {}

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`
const TIPOS = ['relampago', 'prato_do_dia', 'combo'] as const
type Tipo = (typeof TIPOS)[number]
const tipoSchema = z.enum(TIPOS).describe("Tipo da oferta: 'relampago' (Tá Quentinho, dura no máximo 12 h), 'prato_do_dia' (cardápio do dia) ou 'combo'.")

function ok(text: string, data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: `${text}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data }
}
function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Executa a tool convertendo erros esperados em resultado de erro (nunca derruba o servidor). */
async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404 && err.code === 'ROUTE_NOT_FOUND') return fail('Esta operação ainda não existe na API do VizinhoHub (rota não encontrada). Atualize/reinicie a API.')
      return fail(`A API recusou o pedido: ${err.describe()}`)
    }
    if (err instanceof ToolError || err instanceof TimeError) return fail(err.message)
    return fail(`Erro inesperado: ${(err as Error).message}`)
  }
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`).join('; ')
}

function need<T>(value: T | undefined, campo: string, tipo: string): T {
  if (value === undefined) throw new ToolError(`Para oferta do tipo '${tipo}' o campo '${campo}' é obrigatório.`)
  return value
}

// ---- Visão unificada de oferta -----------------------------------------------------------------------

interface OfertaView {
  tipo: Tipo
  id: string
  titulo: string
  precoOriginal: number | null
  precoOferta: number
  quantidadeTotal: number | null
  quantidadeDisponivel: number
  quantidadeVendida: number | null
  limitePorCliente: number | null
  validade: string | null
  validadeFortaleza: string | null
  status: string
}

const flashStatus: Record<string, string> = { ACTIVE: 'ativa', SOLD_OUT: 'esgotada', ENDED: 'encerrada (prazo)', CANCELLED: 'cancelada', SCHEDULED: 'agendada' }

function flashView(f: MerchantFlashDTO): OfertaView {
  return {
    tipo: 'relampago',
    id: f.id,
    titulo: f.productName,
    precoOriginal: f.originalPrice,
    precoOferta: f.offerPrice,
    quantidadeTotal: f.qtyTotal,
    quantidadeDisponivel: f.qtyAvailable,
    quantidadeVendida: f.sold,
    limitePorCliente: f.maxPerCustomer,
    validade: f.endsAt,
    validadeFortaleza: formatFortaleza(f.endsAt),
    status: flashStatus[f.status] ?? f.status,
  }
}
function menuView(m: DailyMenuItemDTO): OfertaView {
  return {
    tipo: 'prato_do_dia',
    id: m.id,
    titulo: m.productName,
    precoOriginal: m.price,
    precoOferta: m.price,
    quantidadeTotal: m.qtyTotal,
    quantidadeDisponivel: m.qtyAvailable,
    quantidadeVendida: m.qtyTotal - m.qtyAvailable,
    limitePorCliente: null,
    validade: m.menuDate,
    validadeFortaleza: `${m.menuDate.split('-').reverse().join('/')} (dia todo)`,
    status: m.isOn ? 'ativo' : 'pausado',
  }
}
function comboView(c: ComboDTO): OfertaView {
  return {
    tipo: 'combo',
    id: c.id,
    titulo: `${c.name} (${c.components.map((x) => `${x.quantity}x ${x.name}`).join(' + ')})`,
    precoOriginal: null,
    precoOferta: c.price,
    quantidadeTotal: null,
    quantidadeDisponivel: c.available,
    quantidadeVendida: null,
    limitePorCliente: null,
    validade: null,
    validadeFortaleza: null,
    status: 'ativo',
  }
}
const linha = (o: OfertaView) => {
  const preco = o.precoOriginal !== null && o.precoOriginal !== o.precoOferta ? `${brl(o.precoOriginal)} por ${brl(o.precoOferta)}` : brl(o.precoOferta)
  const qtd = `disponível ${o.quantidadeDisponivel}${o.quantidadeTotal !== null ? `/${o.quantidadeTotal}` : ''}${o.quantidadeVendida !== null ? `, vendidas ${o.quantidadeVendida}` : ''}`
  return `- [${o.tipo}] ${o.titulo} | ${preco} | ${qtd}${o.limitePorCliente ? `, limite ${o.limitePorCliente}/cliente` : ''}${o.validadeFortaleza ? ` | até ${o.validadeFortaleza}` : ''} | ${o.status} | id ${o.id}`
}

const MOTIVOS = { vencimento: 'EXPIRING', excesso: 'OVERSTOCK', manual: 'MANUAL' } as const

export function createServer(client: ApiClient): McpServer {
  const server = new McpServer({ name: 'vizinhohub-ofertas', version: '0.1.0' })

  // 1. buscar_meus_produtos -------------------------------------------------------------------------
  server.registerTool(
    'buscar_meus_produtos',
    {
      title: 'Buscar meus produtos',
      description:
        'Procura produtos no catálogo da loja do lojista pelo nome (busca parcial). Devolve id, nome, preço, estoque e categoria. ' +
        'TODA oferta (relâmpago, prato do dia, combo) precisa de um produto que já exista no catálogo: use esta tool ANTES de criar a oferta para achar o ID. ' +
        'Se nenhum produto for encontrado, avise o usuário em vez de inventar um ID; ofereça tentar outro termo. Preços em reais (R$).',
      inputSchema: {
        busca: z.string().trim().min(1).max(100).describe('Parte do nome do produto, ex.: "rodízio", "café".'),
        limite: z.number().int().min(1).max(20).optional().describe('Máximo de resultados (1 a 20; padrão 10).'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ busca, limite }) =>
      run(async () => {
        const rows = await client.request<MerchantProductDTO[]>('GET', '/products/mine', { query: { search: busca, limit: limite ?? 10 } })
        const produtos = rows.map((p) => ({
          id: p.id,
          nome: p.name,
          preco: p.price,
          precoEfetivo: p.effectivePrice,
          estoque: p.stockQty,
          unidade: p.unit,
          categoria: p.category.name,
          categoriaId: p.category.id,
        }))
        if (produtos.length === 0) return ok(`Nenhum produto encontrado para "${busca}" no catálogo da loja. Não invente um produto: avise o usuário.`, { produtos })
        return ok(
          `${produtos.length} produto(s) para "${busca}":\n` + produtos.map((p) => `- ${p.nome} | ${brl(p.preco)} | estoque ${p.estoque} | ${p.categoria} | id ${p.id}`).join('\n'),
          { produtos },
        )
      }),
  )

  // 2. listar_minhas_ofertas ------------------------------------------------------------------------
  server.registerTool(
    'listar_minhas_ofertas',
    {
      title: 'Listar minhas ofertas',
      description:
        'Lista as ofertas da loja em uma só lista: relâmpagos (Tá Quentinho), prato do dia de HOJE e combos. Cada item traz tipo, id, título, preço original e da oferta, ' +
        'quantidade total/disponível/vendida, limite por cliente, validade (também em horário de Fortaleza) e status. Use para conferir o que está no ar e para obter o ID antes de atualizar, pausar ou encerrar. ' +
        "status 'ativas' (padrão) mostra só o que está valendo; 'todas' inclui relâmpagos já encerrados/cancelados/esgotados (últimos 100) e pratos pausados.",
      inputSchema: { status: z.enum(['ativas', 'todas']).optional().describe("'ativas' (padrão) ou 'todas'.") },
      annotations: { readOnlyHint: true },
    },
    ({ status }) =>
      run(async () => {
        const [flash, menu, combos] = await Promise.all([
          client.request<MerchantFlashDTO[]>('GET', '/flash/mine'),
          client.request<DailyMenuItemDTO[]>('GET', '/daily-menu/mine'),
          client.request<ComboDTO[]>('GET', '/combos/mine'),
        ])
        const soAtivas = (status ?? 'ativas') === 'ativas'
        let ofertas = [...flash.map(flashView), ...menu.map(menuView), ...combos.map(comboView)]
        if (soAtivas) ofertas = ofertas.filter((o) => o.status === 'ativa' || o.status === 'ativo')
        return ok(ofertas.length ? `${ofertas.length} oferta(s):\n${ofertas.map(linha).join('\n')}` : 'Nenhuma oferta encontrada.', { ofertas })
      }),
  )

  // 3. criar_oferta ---------------------------------------------------------------------------------
  server.registerTool(
    'criar_oferta',
    {
      title: 'Criar oferta',
      description:
        "Cria uma oferta da loja. Escolha o 'tipo' e preencha os campos dele. SEMPRE obtenha produtoId com buscar_meus_produtos antes (nunca invente IDs).\n" +
        "- relampago (Tá Quentinho): produtoId, precoOferta (R$, MENOR que o preço do produto), quantidade (1-1000 unidades), e UM entre 'ate' (HH:MM de hoje, horário de Fortaleza; se já passou, dá erro) ou 'duracaoMinutos' (5-720). " +
        'Dura no máximo 12 h. Opcionais: limitePorCliente (1-20, padrão 2), raioMetros (100-10000, padrão 2000), motivo (vencimento | excesso | manual, padrão manual).\n' +
        '- prato_do_dia: produtoId, porcoes (0-100000), data (YYYY-MM-DD, padrão hoje), ligado (padrão true). Se o produto já está no cardápio da data, é atualizado. O preço é o do produto.\n' +
        '- combo: nome, categoriaId, preco (R$), componentes [{produtoId, quantidade}] com no mínimo 2 produtos distintos; descricao opcional. Vender o combo baixa o estoque dos componentes. Combo não pode ser editado depois (só remover e recriar).',
      inputSchema: {
        tipo: tipoSchema,
        produtoId: uuid.optional().describe('ID do produto (relampago e prato_do_dia).'),
        precoOferta: money().optional().describe('relampago: preço promocional em R$, até 2 casas decimais.'),
        quantidade: z.number().int().min(1).max(1000).optional().describe('relampago: unidades em oferta (1-1000).'),
        limitePorCliente: z.number().int().min(1).max(20).optional().describe('relampago: máximo por cliente (1-20; padrão 2).'),
        raioMetros: z.number().int().min(100).max(10_000).optional().describe('relampago: raio de alcance em metros (100-10000; padrão 2000).'),
        motivo: z.enum(['vencimento', 'excesso', 'manual']).optional().describe('relampago: motivo da promoção (padrão manual).'),
        ate: hhmm.optional().describe('relampago: encerra hoje neste horário HH:MM (Fortaleza, UTC-3). Alternativa a duracaoMinutos.'),
        duracaoMinutos: z.number().int().optional().describe('relampago: duração em minutos a partir de agora (5 a 720). Alternativa a ate.'),
        porcoes: z.number().int().min(0).max(100_000).optional().describe('prato_do_dia: porções do dia.'),
        data: isoDate.optional().describe('prato_do_dia: data YYYY-MM-DD (padrão hoje).'),
        ligado: z.boolean().optional().describe('prato_do_dia: já nasce ligado (padrão true).'),
        nome: z.string().optional().describe('combo: nome do combo (2-160 caracteres).'),
        descricao: z.string().optional().describe('combo: descrição opcional.'),
        categoriaId: z.number().int().positive().optional().describe('combo: ID da categoria (use a categoriaId de buscar_meus_produtos).'),
        preco: z.number().optional().describe('combo: preço do combo em R$.'),
        componentes: z.array(z.object({ produtoId: uuid, quantidade: z.number().int().min(1).max(99) })).optional().describe('combo: itens do combo (mínimo 2 produtos).'),
      },
    },
    (a) =>
      run(async () => {
        if (a.tipo === 'relampago') {
          const produtoId = need(a.produtoId, 'produtoId', a.tipo)
          const precoOferta = need(a.precoOferta, 'precoOferta', a.tipo)
          const quantidade = need(a.quantidade, 'quantidade', a.tipo)
          if ((a.ate === undefined) === (a.duracaoMinutos === undefined)) throw new ToolError("Informe exatamente UM entre 'ate' (HH:MM de hoje) e 'duracaoMinutos'.")
          const durationMin = a.ate !== undefined ? untilToday(a.ate).durationMin : a.duracaoMinutos!
          if (durationMin > 720) throw new ToolError(`A oferta relâmpago dura no máximo 12 h (720 min); o pedido resultaria em ${durationMin} min. Escolha um horário/duração mais curto.`)
          if (durationMin < 5) throw new ToolError(`A oferta relâmpago precisa durar pelo menos 5 minutos; o pedido resultaria em ${durationMin} min.`)
          const body = createFlashSchema.safeParse({
            productId: produtoId,
            offerPrice: precoOferta,
            qtyTotal: quantidade,
            ...(a.limitePorCliente !== undefined && { maxPerCustomer: a.limitePorCliente }),
            ...(a.raioMetros !== undefined && { radiusM: a.raioMetros }),
            durationMin,
            ...(a.motivo && { reason: MOTIVOS[a.motivo] }),
          })
          if (!body.success) throw new ToolError(`Dados inválidos: ${zodMessage(body.error)}`)
          const f = await client.request<MerchantFlashDTO>('POST', '/flash', { body: body.data })
          return ok(`Oferta relâmpago criada: ${f.productName} de ${brl(f.originalPrice)} por ${brl(f.offerPrice)}, ${f.qtyTotal} un., até ${formatFortaleza(f.endsAt)} (Fortaleza). id ${f.id}`, { oferta: flashView(f) })
        }
        if (a.tipo === 'prato_do_dia') {
          const body = setDailyMenuSchema.safeParse({
            productId: need(a.produtoId, 'produtoId', a.tipo),
            qtyTotal: need(a.porcoes, 'porcoes', a.tipo),
            ...(a.data && { menuDate: a.data }),
            ...(a.ligado !== undefined && { isOn: a.ligado }),
          })
          if (!body.success) throw new ToolError(`Dados inválidos: ${zodMessage(body.error)}`)
          const m = await client.request<DailyMenuItemDTO>('PUT', '/daily-menu', { body: body.data })
          return ok(`Prato do dia ${m.isOn ? 'ligado' : 'cadastrado (pausado)'}: ${m.productName}, ${m.qtyTotal} porções em ${m.menuDate}. id ${m.id}`, { oferta: menuView(m) })
        }
        const body = createComboSchema.safeParse({
          name: need(a.nome, 'nome', a.tipo),
          description: a.descricao,
          categoryId: need(a.categoriaId, 'categoriaId', a.tipo),
          price: need(a.preco, 'preco', a.tipo),
          components: need(a.componentes, 'componentes', a.tipo).map((c) => ({ componentId: c.produtoId, quantity: c.quantidade })),
        })
        if (!body.success) throw new ToolError(`Dados inválidos: ${zodMessage(body.error)}`)
        const c = await client.request<ComboDTO>('POST', '/combos', { body: body.data })
        return ok(`Combo criado: ${c.name} por ${brl(c.price)} (${c.available} disponíveis). id ${c.id}`, { oferta: comboView(c) })
      }),
  )

  // 4. atualizar_oferta -----------------------------------------------------------------------------
  server.registerTool(
    'atualizar_oferta',
    {
      title: 'Atualizar oferta',
      description:
        'Altera uma oferta existente (use listar_minhas_ofertas para o id).\n' +
        '- relampago (só enquanto ATIVA): precoOferta (R$, continua menor que o preço original), quantidade (total; não pode ser menor que o já vendido), limitePorCliente (1-20), ate (HH:MM de hoje em Fortaleza; no futuro e dentro de 12 h do início da oferta). Envie só o que muda.\n' +
        '- prato_do_dia: porcoes (novo total do dia) e/ou ligado (true/false). O id é o da linha do cardápio de hoje.\n' +
        '- combo: a API não edita combos; para mudar, remova (pausar_ou_encerrar_oferta) e crie de novo (criar_oferta).',
      inputSchema: {
        tipo: tipoSchema,
        id: uuid.describe('ID da oferta (listar_minhas_ofertas).'),
        precoOferta: money().optional().describe('relampago: novo preço em R$.'),
        quantidade: z.number().int().min(1).max(1000).optional().describe('relampago: novo total de unidades.'),
        limitePorCliente: z.number().int().min(1).max(20).optional().describe('relampago: novo limite por cliente.'),
        ate: hhmm.optional().describe('relampago: novo horário de término HH:MM (hoje, Fortaleza).'),
        porcoes: z.number().int().min(0).max(100_000).optional().describe('prato_do_dia: novo total de porções.'),
        ligado: z.boolean().optional().describe('prato_do_dia: ligar/desligar.'),
      },
    },
    (a) =>
      run(async () => {
        if (a.tipo === 'combo') {
          throw new ToolError('A API não permite editar combos. Para mudar preço ou componentes, remova o combo (pausar_ou_encerrar_oferta com tipo combo) e crie outro com criar_oferta.')
        }
        if (a.tipo === 'relampago') {
          const body: Record<string, unknown> = {}
          if (a.precoOferta !== undefined) body.offerPrice = a.precoOferta
          if (a.quantidade !== undefined) body.qtyTotal = a.quantidade
          if (a.limitePorCliente !== undefined) body.maxPerCustomer = a.limitePorCliente
          if (a.ate !== undefined) body.endsAt = untilToday(a.ate).endsAtIso
          if (Object.keys(body).length === 0) throw new ToolError('Informe ao menos um campo para alterar (precoOferta, quantidade, limitePorCliente ou ate).')
          const f = await client.request<MerchantFlashDTO>('PATCH', `/flash/${a.id}`, { body })
          return ok(`Relâmpago atualizada: ${f.productName} por ${brl(f.offerPrice)}, ${f.qtyAvailable}/${f.qtyTotal} disponíveis, até ${formatFortaleza(f.endsAt)}.`, { oferta: flashView(f) })
        }
        const body: Record<string, unknown> = {}
        if (a.porcoes !== undefined) body.qtyTotal = a.porcoes
        if (a.ligado !== undefined) body.isOn = a.ligado
        if (Object.keys(body).length === 0) throw new ToolError('Informe porcoes e/ou ligado.')
        const m = await client.request<DailyMenuItemDTO>('PATCH', `/daily-menu/${a.id}`, { body })
        return ok(`Prato do dia atualizado: ${m.productName}, ${m.qtyAvailable}/${m.qtyTotal} porções, ${m.isOn ? 'ligado' : 'pausado'}.`, { oferta: menuView(m) })
      }),
  )

  // 5. pausar_ou_encerrar_oferta --------------------------------------------------------------------
  server.registerTool(
    'pausar_ou_encerrar_oferta',
    {
      title: 'Pausar ou encerrar oferta',
      description:
        'Pausa, retoma ou encerra uma oferta (use listar_minhas_ofertas para o id).\n' +
        "- relampago: só 'encerrar' (padrão), que cancela a oferta e é DEFINITIVO; não existe pausa para relâmpago e não dá para reativar (crie outra).\n" +
        "- prato_do_dia: 'pausar' (padrão; desliga hoje, reversível) ou 'retomar' (liga de novo). 'encerrar' equivale a pausar.\n" +
        "- combo: 'encerrar' (padrão) remove o combo da vitrine; pausa/retomada não existem para combo.",
      inputSchema: {
        tipo: tipoSchema,
        id: uuid.describe('ID da oferta.'),
        acao: z.enum(['pausar', 'retomar', 'encerrar']).optional().describe('Ação; o padrão depende do tipo (relampago/combo: encerrar; prato_do_dia: pausar).'),
      },
      annotations: { destructiveHint: true },
    },
    ({ tipo, id, acao }) =>
      run(async () => {
        if (tipo === 'relampago') {
          if (acao && acao !== 'encerrar') throw new ToolError("Oferta relâmpago não pode ser pausada nem retomada: só 'encerrar' (definitivo). Para reativar, crie uma nova oferta.")
          await client.request('POST', `/flash/${id}/cancel`)
          return ok('Oferta relâmpago ENCERRADA de forma definitiva (não há como reativar; crie outra se precisar).', { id, tipo, acao: 'encerrar', definitivo: true })
        }
        if (tipo === 'prato_do_dia') {
          const ligar = (acao ?? 'pausar') === 'retomar'
          const m = await client.request<DailyMenuItemDTO>('PATCH', `/daily-menu/${id}`, { body: { isOn: ligar } })
          return ok(ligar ? `Prato do dia ${m.productName} religado.` : `Prato do dia ${m.productName} pausado (pode ser retomado).`, { oferta: menuView(m), acao: ligar ? 'retomar' : 'pausar', definitivo: false })
        }
        if (acao === 'pausar' || acao === 'retomar') throw new ToolError("Combo não tem pausa: só 'encerrar', que remove o combo (recrie se precisar).")
        await client.request('DELETE', `/combos/${id}`)
        return ok('Combo removido da vitrine.', { id, tipo, acao: 'encerrar', definitivo: true })
      }),
  )

  // 6. resumo_vendas_ofertas ------------------------------------------------------------------------
  server.registerTool(
    'resumo_vendas_ofertas',
    {
      title: 'Resumo de vendas das ofertas',
      description:
        'Resumo de vendas das ofertas: unidades vendidas de cada relâmpago ativa ou recente (últimas 24 h), porções vendidas do prato do dia de hoje e quantos pedidos de hoje (dia de Fortaleza, sem cancelados) contêm itens de oferta relâmpago. Não recebe parâmetros.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const now = new Date()
        const hoje = fortalezaDate(now)
        const [flash, menu, orders] = await Promise.all([
          client.request<MerchantFlashDTO[]>('GET', '/flash/mine'),
          client.request<DailyMenuItemDTO[]>('GET', '/daily-menu/mine'),
          client.request<{ status: string; createdAt: string; items: { flashOfferId?: string | null }[] }[]>('GET', '/orders', { query: { limit: 200 } }),
        ])
        const recentes = flash.filter((f) => f.status === 'ACTIVE' || now.getTime() - new Date(f.endsAt).getTime() < 24 * 3600_000)
        const relampagos = recentes.map((f) => ({ id: f.id, produto: f.productName, status: flashStatus[f.status] ?? f.status, vendidas: f.sold, total: f.qtyTotal }))
        const pratos = menu.map((m) => ({ id: m.id, produto: m.productName, ligado: m.isOn, porcoesVendidas: m.qtyTotal - m.qtyAvailable, porcoesTotal: m.qtyTotal }))
        const pedidosComRelampago = orders.filter((o) => o.status !== 'CANCELLED' && fortalezaDate(new Date(o.createdAt)) === hoje && o.items.some((i) => i.flashOfferId)).length
        const totais = {
          unidadesRelampagoVendidas: relampagos.reduce((s, r) => s + r.vendidas, 0),
          porcoesPratoDoDiaVendidas: pratos.reduce((s, p) => s + p.porcoesVendidas, 0),
          pedidosHojeComRelampago: pedidosComRelampago,
        }
        const texto =
          `Resumo de hoje (${hoje}, Fortaleza): ${totais.unidadesRelampagoVendidas} un. de relâmpago vendidas, ${totais.porcoesPratoDoDiaVendidas} porção(ões) do prato do dia, ${pedidosComRelampago} pedido(s) de hoje com relâmpago.` +
          (relampagos.length ? '\nRelâmpagos:\n' + relampagos.map((r) => `- ${r.produto} (${r.status}): ${r.vendidas}/${r.total} vendidas`).join('\n') : '') +
          (pratos.length ? '\nPrato do dia:\n' + pratos.map((p) => `- ${p.produto}: ${p.porcoesVendidas}/${p.porcoesTotal} porções`).join('\n') : '')
        return ok(texto, { dia: hoje, totais, relampagos, pratoDoDia: pratos })
      }),
  )

  return server
}
