import { idParam } from '@vizinhohub/contracts/common'
import { adjustmentSchema, createCreditAccountSchema, listCreditAccountsSchema, listCreditCandidatesSchema, registerPaymentSchema, updateCreditAccountSchema } from '@vizinhohub/contracts/credit'
import { createComboSchema, dailyMenuQuerySchema, setDailyMenuSchema, updateDailyMenuSchema } from '@vizinhohub/contracts/daily-menu'
import { createPickupSlotSchema, leadTimeSchema, listScheduledOrdersSchema, slotAvailabilityQuerySchema, updatePickupSlotSchema } from '@vizinhohub/contracts/scheduling'
import {
  confirmPinSchema,
  courierLocationSchema,
  courierRegisterSchema,
  courierStatusSchema,
  failDeliverySchema,
  idParam as deliveryIdParam,
  listDeliveriesSchema,
  merchantParam,
  orderParam,
  requestDeliverySchema,
  storeDeliveryConfigSchema,
} from '../../modules/delivery/delivery.schema.js'
import {
  addListItemSchema,
  createCanonicalProductSchema,
  createRecipeSchema,
  createShoppingListSchema,
  linkCanonicalSchema,
  listFromRecipeSchema,
  listItemParam,
  listParam,
  merchantProductsQuery,
  optimizeRequestSchema,
  productParam,
  recipesQuery,
  searchCanonicalSchema,
  slugParam,
  updateShoppingListSchema,
} from '../../modules/smart-cart/smart-cart.schema.js'
import { ledgerQuery } from '../../modules/credit/credit.routes.js'
import { combosQuery } from '../../modules/daily-menu/daily-menu.routes.js'
import { routeFor, type RouteDoc } from '../registry.js'

const delivery = routeFor('Logística')
const credit = routeFor('Caderneta')
const scheduling = routeFor('Agendamento')
const menu = routeFor('Prato do dia')
const cart = routeFor('Carrinho Inteligente')

export const operationsRoutes: RouteDoc[] = [
  // ---- Logística ----
  delivery('get', '/delivery/stores/{merchantId}', 'public', 'Taxa e raio de entrega da loja (checkout)', { params: merchantParam, ok: [200, 'Configuração pública de entrega.'] }),
  delivery('get', '/delivery/config', 'MERCHANT', 'Configuração de entrega da minha loja', { ok: [200, 'Configuração.'] }),
  delivery('put', '/delivery/config', 'MERCHANT', 'Salva a configuração de entrega da minha loja', { body: storeDeliveryConfigSchema, ok: [200, 'Configuração salva.'], errors: [422] }),
  delivery('get', '/delivery/orders', 'MERCHANT', 'Pedidos de entrega da loja', { ok: [200, 'Lista de pedidos com a situação da entrega.'] }),
  delivery('get', '/delivery/deliveries', 'MERCHANT', 'Entregas da loja', { query: listDeliveriesSchema, ok: [200, 'Lista de entregas.'] }),
  delivery('post', '/delivery/deliveries', 'MERCHANT', 'Chama um entregador para um pedido', { body: requestDeliverySchema, ok: [201, 'Entrega criada e ofertada a entregadores próximos.'], errors: [409, 422] }),
  delivery('post', '/delivery/deliveries/{id}/unlock-pin', 'MERCHANT', 'Libera o PIN de entrega ao lojista', { params: deliveryIdParam, ok: [200, 'PIN da entrega.'], errors: [409] }),
  delivery('post', '/delivery/deliveries/{id}/own-fleet/pickup', 'MERCHANT', 'Frota própria: marca a saída para entrega', { params: deliveryIdParam, ok: [200, 'Entrega atualizada.'], errors: [409] }),
  delivery('post', '/delivery/deliveries/{id}/own-fleet/deliver', 'MERCHANT', 'Frota própria: confirma a entrega com o PIN do cliente', {
    params: deliveryIdParam,
    body: confirmPinSchema,
    ok: [200, 'Entrega concluída.'],
    errors: [409, 422],
  }),
  delivery('post', '/delivery/deliveries/{id}/own-fleet/fail', 'MERCHANT', 'Frota própria: registra a falha da entrega', { params: deliveryIdParam, body: failDeliverySchema, ok: [200, 'Entrega marcada como falha.'], errors: [409] }),
  delivery('get', '/delivery/orders/{orderId}', 'login', 'Rastreia a entrega de um pedido (cliente ou lojista do pedido)', { params: orderParam, ok: [200, 'Entrega, entregador e posição.'] }),
  delivery('get', '/delivery/courier', 'CUSTOMER', 'Meu perfil de entregador', { ok: [200, 'Perfil do entregador (ou nulo se não cadastrado).'] }),
  delivery('post', '/delivery/courier', 'CUSTOMER', 'Cadastra-se como entregador', { body: courierRegisterSchema, ok: [201, 'Perfil criado.'], errors: [409] }),
  delivery('put', '/delivery/courier/status', 'CUSTOMER', 'Fica online/offline para receber chamados', { body: courierStatusSchema, ok: [200, 'Perfil atualizado.'], errors: [409] }),
  delivery('get', '/delivery/courier/offers', 'CUSTOMER', 'Chamados ofertados a mim', { ok: [200, 'Lista de ofertas pendentes.'] }),
  delivery('get', '/delivery/courier/active', 'CUSTOMER', 'Minha entrega em andamento', { ok: [200, 'Entrega ativa (ou nula).'] }),
  delivery('post', '/delivery/courier/deliveries/{id}/accept', 'CUSTOMER', 'Aceita um chamado', { params: deliveryIdParam, ok: [200, 'Entrega atribuída a mim.'], errors: [409] }),
  delivery('post', '/delivery/courier/deliveries/{id}/decline', 'CUSTOMER', 'Recusa um chamado', { params: deliveryIdParam, ok: [204, 'Recusado.'] }),
  delivery('put', '/delivery/courier/location', 'CUSTOMER', 'Informa minha localização', {
    description: 'Intervalo mínimo entre atualizações: 5 s.',
    body: courierLocationSchema,
    ok: [200, 'Localização registrada.'],
    errors: [422],
  }),
  delivery('post', '/delivery/courier/deliveries/{id}/pickup', 'CUSTOMER', 'Confirma a retirada do pedido na loja', { params: deliveryIdParam, ok: [200, 'Entrega atualizada.'], errors: [409] }),
  delivery('post', '/delivery/courier/deliveries/{id}/deliver', 'CUSTOMER', 'Confirma a entrega com o PIN do cliente', {
    description: 'O PIN tem 4 dígitos; há limite de tentativas.',
    params: deliveryIdParam,
    body: confirmPinSchema,
    ok: [200, 'Entrega concluída.'],
    errors: [409, 422, 429],
  }),
  delivery('post', '/delivery/courier/deliveries/{id}/fail', 'CUSTOMER', 'Registra a falha da entrega', { params: deliveryIdParam, body: failDeliverySchema, ok: [200, 'Entrega marcada como falha.'], errors: [409] }),

  // ---- Caderneta ----
  credit('get', '/credit/mine', 'CUSTOMER', 'Minhas contas na caderneta (uma por loja)', { ok: [200, 'Lista de contas.'] }),
  credit('get', '/credit/accounts', 'MERCHANT', 'Contas da caderneta da loja', { query: listCreditAccountsSchema, ok: [200, 'Lista de contas com saldo.'] }),
  credit('get', '/credit/candidates', 'MERCHANT', 'Clientes que ainda não têm conta na caderneta', {
    description: 'Clientes que já compraram na loja, ordenados por nome. `search` filtra por nome ou e-mail (substring, sem acento nem caixa); `limit` (padrão 50, máx. 200). O telefone cai para o do pedido mais recente do cliente nesta loja quando o cadastro não tem.',
    query: listCreditCandidatesSchema,
    ok: [200, 'Lista de clientes candidatos.'],
  }),
  credit('post', '/credit/accounts', 'MERCHANT', 'Abre uma conta na caderneta para um cliente', { body: createCreditAccountSchema, ok: [201, 'Conta criada.'], errors: [409, 422] }),
  credit('patch', '/credit/accounts/{id}', 'MERCHANT', 'Atualiza limite/situação de uma conta', { params: idParam, body: updateCreditAccountSchema, ok: [200, 'Conta atualizada.'], errors: [422] }),
  credit('post', '/credit/accounts/{id}/payments', 'MERCHANT', 'Registra um pagamento recebido', { params: idParam, body: registerPaymentSchema, ok: [201, 'Lançamento criado.'], errors: [422] }),
  credit('post', '/credit/accounts/{id}/adjustments', 'MERCHANT', 'Lança um ajuste manual', { params: idParam, body: adjustmentSchema, ok: [201, 'Lançamento criado.'], errors: [422] }),
  credit('post', '/credit/accounts/{id}/reminder', 'MERCHANT', 'Envia lembrete de cobrança (gera o Pix copia-e-cola)', { params: idParam, ok: [200, 'Lembrete e dados de pagamento.'], errors: [422] }),
  credit('get', '/credit/accounts/{id}/ledger', 'login', 'Extrato de uma conta (lojista da conta ou cliente dono)', { params: idParam, query: ledgerQuery, ok: [200, 'Lançamentos do mais recente ao mais antigo.'] }),

  // ---- Agendamento ----
  scheduling('get', '/scheduling/availability', 'login', 'Vagas livres de retirada de uma loja', { query: slotAvailabilityQuerySchema, ok: [200, 'Faixas com vagas por dia.'] }),
  scheduling('get', '/scheduling/slots', 'MERCHANT', 'Minhas faixas de retirada', { ok: [200, 'Lista de faixas.'] }),
  scheduling('post', '/scheduling/slots', 'MERCHANT', 'Cria uma faixa de retirada', { body: createPickupSlotSchema, ok: [201, 'Faixa criada.'], errors: [422] }),
  scheduling('patch', '/scheduling/slots/{id}', 'MERCHANT', 'Atualiza uma faixa de retirada (só vale o que veio no corpo)', { params: idParam, body: updatePickupSlotSchema, ok: [200, 'Faixa atualizada.'], errors: [422] }),
  scheduling('delete', '/scheduling/slots/{id}', 'MERCHANT', 'Remove (ou desativa) uma faixa de retirada', { params: idParam, ok: [200, '`{ result }` com o que foi feito.'] }),
  scheduling('get', '/scheduling/orders', 'MERCHANT', 'Agenda: pedidos agendados da loja', { query: listScheduledOrdersSchema, ok: [200, 'Lista de encomendas.'] }),
  scheduling('patch', '/scheduling/products/{id}/lead-time', 'MERCHANT', 'Define a antecedência (horas) de um produto sob encomenda', { params: idParam, body: leadTimeSchema, ok: [200, 'Produto atualizado.'] }),

  // ---- Prato do dia ----
  menu('get', '/daily-menu', 'public', 'Pratos do dia publicados', { query: dailyMenuQuerySchema, ok: [200, 'Lista de pratos do dia.'] }),
  menu('get', '/daily-menu/mine', 'MERCHANT', 'Meu cardápio do dia', { query: dailyMenuQuerySchema, ok: [200, 'Cardápio da loja.'] }),
  menu('put', '/daily-menu', 'MERCHANT', 'Define o cardápio do dia', { body: setDailyMenuSchema, ok: [200, 'Cardápio salvo.'], errors: [422] }),
  menu('patch', '/daily-menu/{id}', 'MERCHANT', 'Atualiza um prato do dia', { params: idParam, body: updateDailyMenuSchema, ok: [200, 'Prato atualizado.'], errors: [422] }),
  menu('get', '/combos', 'public', 'Combos (opcionalmente de uma loja)', { query: combosQuery, ok: [200, 'Lista de combos.'] }),
  menu('get', '/combos/mine', 'MERCHANT', 'Meus combos', { ok: [200, 'Lista de combos da loja.'] }),
  menu('post', '/combos', 'MERCHANT', 'Cadastra um combo', { body: createComboSchema, ok: [201, 'Combo criado.'], errors: [422] }),
  menu('delete', '/combos/{id}', 'MERCHANT', 'Remove um combo', { params: idParam, ok: [204, 'Removido.'] }),

  // ---- Carrinho Inteligente ----
  cart('get', '/smart-cart/canonicals', 'public', 'Busca itens canônicos', { query: searchCanonicalSchema, ok: [200, 'Lista de itens canônicos.'] }),
  cart('post', '/smart-cart/canonicals', 'MERCHANT', 'Cadastra um item canônico', { body: createCanonicalProductSchema, ok: [201, 'Item criado.'], errors: [409] }),
  cart('get', '/smart-cart/my-products', 'MERCHANT', 'Meus produtos para vincular (`?linked=false` lista os sem item canônico)', { query: merchantProductsQuery, ok: [200, 'Lista de produtos.'] }),
  cart('put', '/smart-cart/products/{productId}/canonical', 'MERCHANT', 'Vincula (ou desvincula) um produto a um item canônico', { params: productParam, body: linkCanonicalSchema, ok: [204, 'Vínculo salvo.'], errors: [422] }),
  cart('get', '/smart-cart/recipes', 'public', 'Busca receitas', { query: recipesQuery, ok: [200, 'Lista de receitas.'] }),
  cart('get', '/smart-cart/recipes/mine', 'login', 'Minhas receitas', { query: recipesQuery, ok: [200, 'Lista de receitas.'] }),
  cart('get', '/smart-cart/recipes/{slug}', 'public', 'Detalhe de uma receita', { params: slugParam, ok: [200, 'Receita com ingredientes.'] }),
  cart('post', '/smart-cart/recipes', 'login', 'Cadastra uma receita', { body: createRecipeSchema, ok: [201, 'Receita criada.'], errors: [409, 422] }),
  cart('get', '/smart-cart/lists', 'login', 'Minhas listas de compras', { ok: [200, 'Lista de listas.'] }),
  cart('post', '/smart-cart/lists', 'login', 'Cria uma lista de compras', { body: createShoppingListSchema, ok: [201, 'Lista criada.'], errors: [422] }),
  cart('post', '/smart-cart/lists/from-recipe', 'login', 'Cria uma lista a partir de uma receita', { body: listFromRecipeSchema, ok: [201, 'Lista criada.'], errors: [422] }),
  cart('get', '/smart-cart/lists/{id}', 'login', 'Detalhe de uma lista de compras', { params: listParam, ok: [200, 'Lista com itens.'] }),
  cart('put', '/smart-cart/lists/{id}', 'login', 'Atualiza uma lista de compras', { params: listParam, body: updateShoppingListSchema, ok: [200, 'Lista atualizada.'], errors: [422] }),
  cart('delete', '/smart-cart/lists/{id}', 'login', 'Apaga uma lista de compras', { params: listParam, ok: [204, 'Removida.'] }),
  cart('post', '/smart-cart/lists/{id}/items', 'login', 'Adiciona um item à lista', { params: listParam, body: addListItemSchema, ok: [201, 'Item adicionado.'], errors: [422] }),
  cart('delete', '/smart-cart/lists/{id}/items/{itemId}', 'login', 'Remove um item da lista', { params: listItemParam, ok: [204, 'Removido.'] }),
  cart('post', '/smart-cart/optimize', 'optional', 'Otimiza onde comprar (menor custo entre as lojas)', {
    description: 'Público para itens avulsos ou receita; usar `listId` exige login.',
    body: optimizeRequestSchema,
    ok: [200, 'Plano de compra por loja, com totais e itens indisponíveis.'],
    errors: [422],
  }),
]
