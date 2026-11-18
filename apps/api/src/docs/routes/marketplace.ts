import { cancelVipSchema, subscribeVipSchema, vipMerchantSettingsSchema } from '@vizinhohub/contracts/vip'
import { z } from 'zod'
import { uploadFlyerQuerySchema } from '../../modules/deals/deals.flyers.js'
import { idParamSchema as dealIdParam, listDealsSchema } from '../../modules/deals/deals.schema.js'
import { alertSchema, createFlashSchema, idParam as flashIdParam, radarQuerySchema } from '../../modules/flash/flash.schema.js'
import { invoiceParam, merchantIdParam } from '../../modules/vip/vip.routes.js'
import { routeFor, type RouteDoc } from '../registry.js'

const deals = routeFor('Ofertas do Bairro')
const flash = routeFor('Tá Quentinho')
const vip = routeFor('Clube VIP')

export const marketplaceRoutes: RouteDoc[] = [
  // ---- Ofertas do Bairro ----
  deals('get', '/deals', 'public', 'Ofertas vigentes dos supermercados do bairro', { query: listDealsSchema, ok: [200, 'Lista de ofertas.'] }),
  deals('get', '/deals/chains', 'public', 'Redes monitoradas com a quantidade de ofertas vigentes', { ok: [200, 'Lista de redes.'] }),
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
  deals('get', '/deals/{id}', 'public', 'Detalhe de uma oferta', { params: dealIdParam, ok: [200, 'Oferta.'] }),
  deals('post', '/deals/{id}/coupon', 'login', 'Reserva a oferta e gera o cupom', {
    description: 'Devolve o código para apresentar no caixa da rede, válido por 24 h.',
    params: dealIdParam,
    ok: [201, 'Cupom gerado.'],
    errors: [409, 422],
  }),
  deals('get', '/coupons/mine', 'login', 'Meus cupons', { ok: [200, 'Lista de cupons.'] }),

  // ---- Tá Quentinho ----
  flash('get', '/flash/radar', 'public', 'Radar de ofertas relâmpago perto de uma coordenada', { query: radarQuerySchema, ok: [200, 'Ofertas ordenadas por distância.'] }),
  flash('get', '/flash/mine', 'MERCHANT', 'Minhas ofertas relâmpago', { ok: [200, 'Lista de ofertas da loja.'] }),
  flash('post', '/flash', 'MERCHANT', 'Cria uma oferta relâmpago', { body: createFlashSchema, ok: [201, 'Oferta criada.'], errors: [422] }),
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
