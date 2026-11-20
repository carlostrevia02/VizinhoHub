import { cancelVipSchema, subscribeVipSchema, vipMerchantSettingsSchema } from '@vizinhohub/contracts/vip'
import { z } from 'zod'
import { uploadFlyerQuerySchema } from '../../modules/deals/deals.flyers.js'
import { chainSlugParamSchema, idParamSchema as dealIdParam, dealLocationSchema, listDealsSchema, structuredFlyerDocSchema } from '../../modules/deals/deals.schema.js'
import { alertSchema, createFlashSchema, idParam as flashIdParam, radarQuerySchema, updateFlashSchema } from '../../modules/flash/flash.schema.js'
import { invoiceParam, merchantIdParam } from '../../modules/vip/vip.routes.js'
import { routeFor, type RouteDoc } from '../registry.js'

const deals = routeFor('Ofertas do Bairro')
const flash = routeFor('Tá Quentinho')
const vip = routeFor('Clube VIP')

export const marketplaceRoutes: RouteDoc[] = [
  // ---- Ofertas do Bairro ----
  deals('get', '/deals', 'public', 'Ofertas vigentes dos supermercados do bairro', {
    description:
      'Com `?lat=&lng=` (os dois juntos; um sem o outro dá 400), cada oferta traz `nearestBranch`: a filial da rede que o cliente alcança mais rápido, com `distanceM` e `durationS` da rota (OSRM; `estimated: true` quando só deu para estimar por linha reta) e `atBranch: true` quando o cliente já está na loja (a menos de `BRANCH_AT_RADIUS_M`, padrão 50 m). Se a oferta tem bairro e a rede tem filial ativa nele, só as filiais do bairro valem. Sem coordenadas, ou sem filial cadastrada na rede, `nearestBranch` é `null`. Não altera filtros nem ordenação.',
    query: listDealsSchema,
    ok: [200, 'Lista de ofertas.'],
  }),
  deals('get', '/deals/chains', 'public', 'Redes monitoradas com a quantidade de ofertas vigentes', { ok: [200, 'Lista de redes.'] }),
  deals('get', '/deals/chains/{slug}/branches', 'public', 'Filiais ativas de uma rede', {
    description: 'Lista `[{ id, name, address, neighborhood, latitude, longitude }]` das filiais ativas da rede (slug como em `GET /deals/chains`). Rede inexistente: 404 CHAIN_NOT_FOUND.',
    params: chainSlugParamSchema,
    ok: [200, 'Filiais da rede (pode ser lista vazia).'],
  }),
  deals('post', '/deals/flyers/structured', 'MERCHANT', 'Envia um encarte já estruturado (JSON), sem arquivo', {
    description:
      'Para quem já leu o encarte (ex.: o Claude no chat, via MCP): envia as ofertas prontas, de 1 a 200, e não exige `ANTHROPIC_API_KEY`. Mesma autorização do envio de arquivo (rede ativa, 404 CHAIN_NOT_FOUND; usuário gerente da rede, 403 NOT_CHAIN_MANAGER) e mesma normalização do extrator (percentual e elegibilidade a cupom recalculados; desconto acima de 90% ou preço promocional maior ou igual ao original é descartado). Cada oferta é validada à parte: uma ruim não derruba as outras. Responde **201** na hora com o mesmo objeto de `GET /deals/flyers/{id}` (`status: SUCCESS`, `itemsExtracted`, `itemsDropped`; `mediaType` é `application/json`) e, se alguma oferta foi descartada, `dropped: [{ index, productName, reason }]` (`index` = posição em `deals`, base 0). Se **todas** forem descartadas: 422 NO_VALID_DEALS, com `error.details.dropped`. `append` (padrão false): false desativa as ofertas antigas da mesma rede+bairro; true acrescenta (encarte de várias páginas). Corpo de até 1 MB.',
    body: structuredFlyerDocSchema,
    ok: [201, 'Ofertas gravadas (encarte com status SUCCESS e, se houver, a lista `dropped`).'],
    errors: [422, 429],
  }),
  deals('post', '/deals/flyers', 'MERCHANT', 'Envia um encarte (PDF/JPEG/PNG/WebP) para leitura das ofertas', {
    description:
      'O corpo da requisição é o próprio arquivo (qualquer `Content-Type`; o tipo real é conferido pelos bytes). Parâmetros na query: `?chain=sao-luiz&neighborhood=Aldeota`. Responde 202 na hora; acompanhe em `GET /deals/flyers/{id}`.',
    query: uploadFlyerQuerySchema,
    rawBody: { contentType: 'application/octet-stream', description: 'Bytes do encarte (até 20 MB).' },
    ok: [202, 'Encarte aceito; a leitura roda em segundo plano.'],
    errors: [429],
  }),
  deals('get', '/deals/flyers', 'MERCHANT', 'Encartes enviados por mim', { ok: [200, 'Lista de encartes.'] }),
  deals('get', '/deals/flyers/{id}', 'MERCHANT', 'Situação de um encarte enviado', { params: dealIdParam, ok: [200, 'Encarte e resultado da leitura.'] }),
  deals('get', '/deals/{id}', 'public', 'Detalhe de uma oferta', {
    description: 'Aceita `?lat=&lng=` (juntos) como em `GET /deals`: com eles a oferta traz `nearestBranch`; sem, `null`.',
    params: dealIdParam,
    query: dealLocationSchema,
    ok: [200, 'Oferta.'],
  }),
  deals('post', '/deals/{id}/coupon', 'login', 'Reserva a oferta e gera o cupom', {
    description: 'Devolve o código para apresentar no caixa da rede, válido por 24 h.',
    params: dealIdParam,
    ok: [201, 'Cupom gerado.'],
    errors: [409, 422],
  }),
  deals('get', '/coupons/mine', 'login', 'Meus cupons', { ok: [200, 'Lista de cupons.'] }),
  deals('post', '/coupons/{id}/confirm', 'login', 'Confirmo que comprei (cupom vira REDEEMED)', {
    description: 'Compra confirmada pelo cliente: só então o cupom vira venda e lucro. Cupom de outro cliente ou inexistente: 404 COUPON_NOT_FOUND; já confirmado: 409 COUPON_ALREADY_CONFIRMED; vencido: 409 COUPON_EXPIRED.',
    params: dealIdParam,
    ok: [200, 'Cupom confirmado (status REDEEMED, com redeemedAt).'],
    errors: [404, 409],
  }),

  // ---- Tá Quentinho ----
  flash('get', '/flash/radar', 'public', 'Radar de ofertas relâmpago perto de uma coordenada', { query: radarQuerySchema, ok: [200, 'Ofertas ordenadas por distância.'] }),
  flash('get', '/flash/mine', 'MERCHANT', 'Minhas ofertas relâmpago', { ok: [200, 'Lista de ofertas da loja.'] }),
  flash('post', '/flash', 'MERCHANT', 'Cria uma oferta relâmpago', { body: createFlashSchema, ok: [201, 'Oferta criada.'], errors: [422] }),
  flash('patch', '/flash/{id}', 'MERCHANT', 'Edita uma oferta relâmpago ativa', {
    params: flashIdParam,
    body: updateFlashSchema,
    ok: [200, 'Oferta atualizada (mesmo formato de /flash/mine).'],
    errors: [400, 401, 403, 404, 409, 422],
  }),
  flash('post', '/flash/{id}/cancel', 'MERCHANT', 'Cancela uma oferta relâmpago', { params: flashIdParam, ok: [204, 'Cancelada.'], errors: [409] }),
  flash('get', '/me/alerts', 'login', 'Meus alertas "perto de casa"', { ok: [200, 'Lista de alertas.'] }),
  flash('post', '/me/alerts', 'login', 'Cria um alerta "perto de casa"', { body: alertSchema, ok: [201, 'Alerta criado.'], errors: [422] }),
  flash('delete', '/me/alerts/{id}', 'login', 'Remove um alerta', { params: flashIdParam, ok: [204, 'Removido.'] }),

  // ---- Clube VIP ----
  vip('get', '/vip/plans', 'public', 'Planos e faixas de desconto do Clube VIP', { ok: [200, 'Planos e faixas.'] }),
  vip('post', '/vip/webhooks/{provider}', 'public', 'Webhook do provedor de pagamento', {
    description: 'Sem login: a autenticidade é o token/segredo do header (verificado pelo adapter do provedor: `mock` ou `asaas`).',
    body: z.object({}).loose(),
    ok: [200, 'Evento processado.'],
    errors: [401],
  }),
  vip('get', '/vip/me', 'login', 'Minha assinatura VIP', { ok: [200, 'Estado da assinatura.'] }),
  vip('get', '/vip/discount/{merchantId}', 'login', 'Desconto VIP que terei numa loja', {
    description: '0 se o cliente não é VIP ou a loja não aderiu.',
    params: merchantIdParam,
    ok: [200, 'Percentual de desconto.'],
  }),
  vip('get', '/vip/invoices', 'login', 'Minhas faturas VIP', { ok: [200, 'Lista de faturas.'] }),
  vip('post', '/vip/subscribe', 'CUSTOMER', 'Assina o Clube VIP', { body: subscribeVipSchema, ok: [201, 'Assinatura e fatura criadas.'], errors: [409, 422] }),
  vip('post', '/vip/cancel', 'CUSTOMER', 'Cancela a assinatura VIP', { body: cancelVipSchema, ok: [200, 'Assinatura atualizada.'], errors: [409] }),
  vip('post', '/vip/dev/invoices/{id}/pay', 'CUSTOMER', 'Simula o pagamento de uma fatura (só provedor mock fora de produção)', {
    params: invoiceParam,
    ok: [200, 'Fatura paga.'],
  }),
  vip('get', '/vip/merchant', 'MERCHANT', 'Estado da adesão da loja ao Clube VIP', { ok: [200, 'Adesão e métricas.'] }),
  vip('put', '/vip/merchant', 'MERCHANT', 'Adere ao Clube VIP ou altera as condições', { body: vipMerchantSettingsSchema, ok: [200, 'Estado da adesão.'], errors: [422] }),
  vip('post', '/vip/merchant', 'MERCHANT', 'Adere ao Clube VIP com os padrões', {
    description: 'Corpo opcional: sem ele, usa os padrões (teto 10 %, plataforma banca o frete).',
    body: vipMerchantSettingsSchema,
    ok: [201, 'Estado da adesão.'],
    errors: [422],
  }),
  vip('delete', '/vip/merchant', 'MERCHANT', 'Sai do Clube VIP', { ok: [204, 'Adesão encerrada.'] }),
]
