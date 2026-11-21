import { becomeMerchantSchema, firebaseLoginSchema, loginSchema, registerSchema, updateMeSchema } from '../../modules/auth/auth.schema.js'
import { createProductSchema, idParamSchema, listProductsSchema, updateProductSchema } from '../../modules/products/products.schema.js'
import { createOrderSchema, listOrdersSchema, orderIdSchema, posSaleSchema, updateStatusSchema } from '../../modules/orders/orders.schema.js'
import { storeIdSchema, storeSettingsSchema } from '../../modules/stores/stores.schema.js'
import { routeFor, type RouteDoc } from '../registry.js'
import { createCategorySchema as createCategoryBody } from '../../modules/categories/categories.routes.js'

const health = routeFor('Saúde')
const auth = routeFor('Autenticação')
const categories = routeFor('Categorias')
const products = routeFor('Produtos')
const orders = routeFor('Pedidos')
const pos = routeFor('PDV')
const stores = routeFor('Lojas')


export const coreRoutes: RouteDoc[] = [
  { ...health('get', '/health', 'public', 'Verifica se a API e o banco respondem', { ok: [200, '`{ "status": "ok" }`'] }), root: true },

  // ---- Autenticação ----
  auth('post', '/auth/register', 'public', 'Cria uma conta (cliente)', { body: registerSchema, ok: [201, 'Usuário criado, com o token JWT da API.'], errors: [409, 429] }),
  auth('post', '/auth/login', 'public', 'Entra com e-mail e senha', { body: loginSchema, ok: [200, 'Usuário e token JWT da API.'], errors: [401, 429] }),
  auth('post', '/auth/firebase', 'public', 'Troca um ID token do Firebase Auth pelo token da API', {
    description: 'Responde 501 quando o servidor não tem `FIREBASE_PROJECT_ID`.',
    body: firebaseLoginSchema,
    ok: [200, 'Usuário e token JWT da API.'],
    errors: [401, 429, 501],
  }),
  auth('get', '/auth/me', 'login', 'Perfil do usuário logado', { ok: [200, 'Dados do usuário (e da loja, se for lojista).'] }),
  auth('patch', '/auth/me', 'login', 'Atualiza o perfil do usuário logado', { body: updateMeSchema, ok: [200, 'Perfil atualizado.'], errors: [409] }),
  auth('post', '/auth/become-merchant', 'login', 'Transforma a conta em lojista (cria a loja)', { body: becomeMerchantSchema, ok: [200, 'Perfil já como lojista.'], errors: [409, 429] }),

  // ---- Categorias ----
  categories('get', '/categories', 'public', 'Lista os departamentos com a quantidade de produtos vendáveis hoje', { ok: [200, 'Lista de `{ id, name, productCount }`.'] }),
  categories('post', '/categories', 'MERCHANT', 'Cria uma categoria', { body: createCategoryBody, ok: [201, 'Categoria criada.'], errors: [409] }),

  // ---- Produtos ----
  products('get', '/products', 'public', 'Vitrine pública: produtos vendáveis hoje, com o preço final do Salva-Estoque', { query: listProductsSchema, ok: [200, 'Lista de produtos (com desconto por validade aplicado).'] }),
  products('get', '/products/mine', 'MERCHANT', 'Produtos da loja (inclui vencidos)', { query: listProductsSchema, ok: [200, 'Lista de produtos da loja.'] }),
  products('get', '/products/{id}', 'public', 'Detalhe de um produto da vitrine', { params: idParamSchema, ok: [200, 'Produto.'] }),
  products('post', '/products', 'MERCHANT', 'Cadastra um produto', { body: createProductSchema, ok: [201, 'Produto criado.'], errors: [422] }),
  products('put', '/products/{id}', 'MERCHANT', 'Atualiza um produto', { params: idParamSchema, body: updateProductSchema, ok: [200, 'Produto atualizado.'], errors: [422] }),
  products('delete', '/products/{id}', 'MERCHANT', 'Remove o produto (remoção lógica)', { params: idParamSchema, ok: [204, 'Removido. O histórico de pedidos continua apontando para ele.'] }),

  // ---- Pedidos ----
  orders('post', '/orders', 'CUSTOMER', 'Finaliza o carrinho e cria o pedido', {
    description: 'Emite o evento WebSocket `order:created` para o painel da loja.',
    body: createOrderSchema,
    ok: [201, 'Pedido criado.'],
    errors: [409, 422],
  }),
  orders('get', '/orders', 'login', 'Lista pedidos', {
    description: 'Lojista: pedidos da loja (carga inicial do Kanban com `?active=true`). Cliente: os próprios pedidos. Mais recentes primeiro; pagine com `limit` (até 200) + `offset` e leia o total (com os filtros, sem paginação) no cabeçalho `X-Total-Count`.',
    query: listOrdersSchema,
    ok: [200, 'Lista de pedidos.'],
  }),
  orders('get', '/orders/{id}', 'login', 'Detalhe de um pedido', { params: orderIdSchema, ok: [200, 'Pedido com itens.'] }),
  orders('patch', '/orders/{id}/status', 'MERCHANT', 'Move o pedido no Kanban', {
    description: 'PENDING → IN_PREPARATION → READY → COMPLETED (ou CANCELLED). Emite `order:status_updated`.',
    params: orderIdSchema,
    body: updateStatusSchema,
    ok: [200, 'Pedido atualizado.'],
    errors: [422],
  }),

  // ---- PDV ----
  pos('post', '/pos/sales', 'MERCHANT', 'Registra uma venda de balcão', {
    description: 'Histórico do dia: `GET /orders?channel=POS`.',
    body: posSaleSchema,
    ok: [201, 'Venda registrada como pedido do canal POS.'],
    errors: [422],
  }),

  // ---- Lojas ----
  stores('get', '/stores/me/settings', 'MERCHANT', 'Configurações da própria loja', { ok: [200, 'Horários, entrega e pagamentos.'] }),
  stores('put', '/stores/me/settings', 'MERCHANT', 'Salva as configurações da própria loja', { body: storeSettingsSchema, ok: [200, 'Configurações salvas.'] }),
  stores('get', '/stores/{id}', 'public', 'Página pública da loja (horários, entrega, pagamentos)', { params: storeIdSchema, ok: [200, 'Dados públicos da loja.'] }),
]
