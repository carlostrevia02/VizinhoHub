import { addressSchema as addressBody, idSchema as idParam } from '../../modules/addresses/addresses.routes.js'
import { dashboardQuerySchema } from '../../modules/analytics/analytics.schema.js'
import { idParam as opsIdParam, printAckSchema, pushSubscribeSchema, pushUnsubscribeSchema, trackEventSchema } from '../../modules/ops/ops.schema.js'
import { querySchema as reportQuery } from '../../modules/reports/reports.routes.js'
import { routeFor, type RouteDoc } from '../registry.js'

const addresses = routeFor('Endereços')
const reports = routeFor('Relatórios')
const analytics = routeFor('Analytics')
const ops = routeFor('Operação')

export const accountRoutes: RouteDoc[] = [
  // ---- Endereços ----
  addresses('get', '/me/addresses', 'login', 'Lista os endereços do usuário (o principal primeiro)', { ok: [200, 'Lista de endereços.'] }),
  addresses('post', '/me/addresses', 'login', 'Cadastra um endereço (máx. 10)', {
    description: 'O primeiro endereço já nasce principal; marcar outro como principal desmarca o anterior.',
    body: addressBody,
    ok: [201, 'Endereço criado.'],
    errors: [422],
  }),
  addresses('put', '/me/addresses/{id}', 'login', 'Atualiza um endereço', { params: idParam, body: addressBody, ok: [200, 'Endereço atualizado.'] }),
  addresses('delete', '/me/addresses/{id}', 'login', 'Remove um endereço', {
    description: 'Se era o principal, o endereço mais antigo assume.',
    params: idParam,
    ok: [204, 'Removido.'],
  }),

  // ---- Relatórios ----
  reports('get', '/reports/summary', 'MERCHANT', 'Resumo de vendas por período', {
    description: 'Cancelados não contam como venda; "dia" = dia em Fortaleza. Período máximo de 366 dias.',
    query: reportQuery,
    ok: [200, 'Totais, ticket médio, taxa de cancelamento, série diária, receita por categoria e mais vendidos.'],
    errors: [422],
  }),

  // ---- Analytics ----
  analytics('get', '/analytics/dashboard', 'MERCHANT', 'Dashboard analítico da loja', {
    description: 'Sempre da loja de quem está logado. Conta só COMPRA CONFIRMADA, em dois canais: pedido online (filtrado por `status`: `valid` = padrão, sem cancelados; `all`; ou lista separada por vírgula) e cupom de oferta de supermercado confirmado pelo cliente (`REDEEMED`, na data de `redeemed_at`; atribuído ao comerciante pelos encartes dele). `kpis.revenue`, `orders` e `averageTicket` somam os dois canais; `kpis.profit` é o lucro do VizinhoHub nos cupons ((preço base − preço do encarte) × quantidade mínima); `channels` divide o período atual em `online` e `coupon`. `hourly` e `payments` (fatia `coupon`, "Cupom (retirada)") incluem os cupons; `abc` considera só itens de pedido online. `topOffers` (até 10 ofertas, por lucro) e `topCustomers` (até 10 clientes, por valor gasto). `kpis.conversion` = compras (pedidos online + cupons confirmados) ÷ visitas; `kpis.flyerConversion` = ofertas com compra confirmada ÷ ofertas extraídas. Cupom emitido e não confirmado não é venda. Resposta com `Cache-Control: private, max-age=15`.',
    query: dashboardQuerySchema,
    ok: [200, 'Indicadores (inclui `profit`), funil, séries, `channels`, `topOffers` e `topCustomers` do período.'],
    errors: [422],
  }),

  // ---- Operação ----
  ops('post', '/events', 'optional', 'Registra um evento do funil da vitrine (telemetria)', {
    description: 'Anônimo, com limite por IP. Se vier token válido, grava o usuário (token inválido é ignorado).',
    body: trackEventSchema,
    ok: [204, 'Evento registrado.'],
    errors: [429],
  }),
  ops('get', '/print-jobs/pending', 'MERCHANT', 'Fila de impressão pendente do caixa', { ok: [200, 'Trabalhos de impressão pendentes.'] }),
  ops('post', '/print-jobs/{id}/ack', 'MERCHANT', 'Confirma o resultado (sucesso ou falha) de um trabalho de impressão', { params: opsIdParam, body: printAckSchema, ok: [204, 'Confirmação registrada.'] }),
  ops('post', '/print-jobs/orders/{id}/reprint', 'MERCHANT', 'Reimprime a comanda de um pedido', { params: opsIdParam, ok: [201, 'Novo trabalho de impressão: `{ id }`.'] }),
  ops('get', '/push/key', 'public', 'Chave pública VAPID para o navegador pedir permissão de push', { ok: [200, '`{ publicKey }`.'], errors: [501] }),
  ops('post', '/push/subscribe', 'login', 'Registra a inscrição de push do navegador', { body: pushSubscribeSchema, ok: [204, 'Inscrição salva.'] }),
  ops('post', '/push/unsubscribe', 'login', 'Cancela a inscrição de push', { body: pushUnsubscribeSchema, ok: [204, 'Inscrição removida.'] }),
]
