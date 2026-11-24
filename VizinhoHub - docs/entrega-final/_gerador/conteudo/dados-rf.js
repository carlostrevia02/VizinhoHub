'use strict'
// Requisitos funcionais: UMA lista, usada nas tabelas do capítulo 4 e na matriz de rastreabilidade.
// Os IDs RF-NNN são atribuídos pela ordem abaixo (a documentação anterior não tinha IDs de requisito).
// p: M(ust) S(hould) C(ould) W(on't agora)   st: I = Implementado, P = Parcial, PL = Planejado
const G = []
const add = (grupo, key, desc, p, st, api, rota, tela, teste) => G.push({ grupo, key, desc, p, st, api, rota, tela, teste })

const A = 'Autenticação e RBAC'
add(A, 'reg', 'Cadastro público de cliente com e-mail e senha (mínimo 8 caracteres)', 'M', 'I', 'auth', 'POST /auth/register', '/login', 'auth.test.ts')
add(A, 'login', 'Login por e-mail e senha com token JWT (HS256, 7 dias); erro igual para senha errada e e-mail inexistente', 'M', 'I', 'auth', 'POST /auth/login', '/login', 'auth.test.ts')
add(A, 'fb', 'Login com Google via Firebase (ID token trocado por token da API; vínculo só com e-mail verificado)', 'S', 'I', 'auth', 'POST /auth/firebase', '/login', 'firebase.test.ts, auth.test.ts')
add(A, 'rbac', 'Papel (cliente ou comerciante) lido do banco a cada requisição; rotas do painel só para comerciante', 'M', 'I', 'shared/auth', 'middleware `requireRole`', 'ProtectedRoute (painel)', 'auth.test.ts, orders.flow.test.ts')
add(A, 'perfil', 'Consultar e editar perfil e dados da loja (nome, telefone, bairro, coordenadas)', 'M', 'I', 'auth', 'GET e PATCH /auth/me', '/conta, /configuracoes', 'auth.test.ts')
add(A, 'become', 'Abrir loja a partir de uma conta de cliente', 'C', 'P', 'auth', 'POST /auth/become-merchant', 'sem tela (lojista criado por script)', 'sem teste dedicado')
add(A, 'rate', 'Limitar tentativas de login e cadastro (20 por IP em 15 minutos)', 'M', 'I', 'shared/rate-limit', 'POST /auth/*', '/login', 'sem teste dedicado')

const P = 'Produtos e vitrine'
add(P, 'cat', 'Listar departamentos com a contagem de produtos vendáveis', 'M', 'I', 'categories', 'GET /categories', '/, /produtos', 'catalog.test.ts')
add(P, 'vitrine', 'Vitrine pública de produtos com busca sem acento, filtros por departamento e loja e paginação', 'M', 'I', 'products', 'GET /products', '/produtos', 'catalog.test.ts')
add(P, 'prod', 'Detalhe do produto', 'M', 'I', 'products', 'GET /products/{id}', '/produto/:id', 'catalog.test.ts')
add(P, 'crud', 'CRUD de produtos do lojista (cadastro, edição parcial, remoção lógica) com validação de preço e validade', 'M', 'I', 'products', 'POST, PUT, DELETE /products; GET /products/mine', '/meus-produtos, /admin-produto', 'catalog.test.ts')
add(P, 'otim', 'Bloqueio otimista na edição de produto (campo `version`; conflito vira 409)', 'S', 'I', 'products', 'PUT /products/{id}', '/admin-produto', 'ops.test.ts')
add(P, 'live', 'Vitrine atualizada em tempo real quando o catálogo muda (namespace público `/catalog`)', 'C', 'I', 'catalog-live', 'Socket.io `/catalog`', 'CatalogContext', 'catalog-live.test.ts')
add(P, 'loja', 'Página pública da loja e configurações (horários, entrega, retirada, pagamentos, chave Pix)', 'S', 'I', 'stores', 'GET /stores/{id}; GET e PUT /stores/me/settings', '/loja, /configuracoes', 'credit.test.ts, delivery.test.ts')
add(P, 'end', 'Endereços de entrega do usuário (até 10, um principal, mapa e CEP)', 'S', 'I', 'addresses', '/me/addresses', '/conta', 'sem teste dedicado')

const S = 'Salva-Estoque'
add(S, 'sv', 'Desconto automático por validade: 50% se vence hoje ou amanhã, 30% em até 3 dias', 'M', 'I', 'products (função `refresh_clearance`)', 'GET /products', '/ofertas', 'catalog.test.ts')
add(S, 'svjob', 'Recalcular o Salva-Estoque ao subir a API, de hora em hora e a cada cadastro ou edição', 'M', 'I', 'shared/jobs', 'job horário', '-', 'catalog.test.ts')
add(S, 'svui', 'Exibir preço original riscado e selo de desconto na vitrine', 'S', 'I', 'products', 'GET /products', '/ofertas, /produtos', 'sem teste automatizado (front)')

const O = 'Carrinho e pedidos'
add(O, 'cart', 'Carrinho persistido por usuário e por visitante, com edição de itens', 'M', 'I', 'front (CartContext)', '-', '/carrinho', 'sem teste automatizado (front)')
add(O, 'pedido', 'Criar pedido de uma única loja com preço calculado no servidor', 'M', 'I', 'orders', 'POST /orders', '/carrinho', 'orders.realtime.test.ts')
add(O, 'regras', 'Aplicar regras da loja no checkout: entrega ou retirada, pedido mínimo e formas de pagamento', 'S', 'I', 'orders, stores', 'POST /orders', '/carrinho', 'delivery.test.ts, credit.test.ts')
add(O, 'lista', 'Listar pedidos (lojista: da loja; cliente: os próprios) com filtros e paginação (`X-Total-Count`)', 'M', 'I', 'orders', 'GET /orders', '/pedidos, /conta', 'orders.flow.test.ts')
add(O, 'det', 'Detalhe do pedido restrito ao dono e à loja (outra loja recebe 404)', 'M', 'I', 'orders', 'GET /orders/{id}', '/pedido-detalhe, /acompanhar/:id', 'orders.flow.test.ts')
add(O, 'estados', 'Máquina de estados do pedido; transição inválida devolve 409', 'M', 'I', 'orders', 'PATCH /orders/{id}/status', '/manager', 'orders.flow.test.ts')
add(O, 'cancel', 'Cancelar devolve saldo da oferta, porções, vaga da faixa, limite do cliente e estorna o fiado', 'M', 'I', 'orders, flash, daily-menu, scheduling, credit', 'PATCH /orders/{id}/status', '/manager', 'flash.test.ts, scheduling.test.ts, credit.test.ts')
add(O, 'acomp', 'Cliente acompanha o pedido e vê a mudança de status sem recarregar', 'M', 'I', 'shared/realtime', 'evento `order:status_updated`', '/acompanhar/:id', 'orders.realtime.test.ts')

const K = 'Kanban em tempo real'
add(K, 'kcreated', 'Novo pedido chega ao painel da loja dona por WebSocket (sala `merchant:<id>`), sem recarregar', 'M', 'I', 'shared/realtime', 'evento `order:created`', '/manager', 'orders.realtime.test.ts')
add(K, 'ws', 'Handshake do WebSocket autenticado por JWT; recusa conexão sem token', 'M', 'I', 'shared/realtime', 'Socket.io', '-', 'orders.realtime.test.ts')
add(K, 'alerta', 'Alerta sonoro e aviso visual de pedido novo; indicador de conexão ao vivo', 'S', 'I', 'front (lib/alert.js)', '-', '/manager', 'sem teste automatizado (front)')
add(K, 'print', 'Fila de impressão da comanda (80 mm) persistida, com reimpressão', 'S', 'I', 'ops', '/print-jobs', '/manager', 'ops.test.ts')
add(K, 'push', 'Notificações push (Web Push, PWA) para lojista e cliente', 'C', 'I', 'ops', '/push/*', 'PushToggle', 'ops.test.ts')
add(K, 'pwa', 'PWA instalável com cache do shell e do catálogo estático (pedido nunca vem do cache)', 'S', 'I', 'front (sw.js)', '-', 'todas', 'sem teste automatizado (front)')

const R = 'Ofertas relâmpago (Tá Quentinho)'
add(R, 'fcria', 'Criar oferta relâmpago (preço menor que o atual, quantidade, limite por cliente, raio, duração de 5 min a 12 h)', 'M', 'I', 'flash', 'POST /flash', '/ofertas-relampago', 'flash.test.ts')
add(R, 'fedit', 'Editar e cancelar oferta ativa', 'S', 'I', 'flash', 'PATCH /flash/{id}; POST /flash/{id}/cancel', '/ofertas-relampago', 'flash.test.ts')
add(R, 'radar', 'Radar público de ofertas relâmpago por coordenada e categoria', 'M', 'I', 'flash', 'GET /flash/radar', '/radar', 'flash.test.ts')
add(R, 'fcompra', 'Compra com baixa atômica do saldo e limite por cliente na mesma transação do pedido', 'M', 'I', 'flash, orders', 'POST /orders (`flashOfferId`)', '/carrinho', 'flash.test.ts, modulos-schema.test.ts')
add(R, 'falerta', 'Alertas "perto de casa" por raio, categoria e horário silencioso', 'C', 'I', 'flash', '/me/alerts', '/radar', 'flash.test.ts')
add(R, 'fexp', 'Encerramento automático das ofertas vencidas (job a cada minuto)', 'M', 'I', 'flash, shared/jobs', 'job', '-', 'flash.test.ts')

const D = 'Ofertas do bairro e cupons'
add(D, 'dlist', 'Vitrine pública de ofertas dos supermercados com filtros (busca, bairro, rede, categoria, cupom, relâmpago)', 'M', 'I', 'deals', 'GET /deals', '/ofertas-do-bairro, /ofertas', 'deals.test.ts')
add(D, 'dscan', 'Leitura automática de páginas das redes por IA (job horário, `robots.txt`, hash do conteúdo, trava de varredura única)', 'S', 'I', 'deals, shared/jobs', 'job', '-', 'deals.test.ts')
add(D, 'dval', 'Validação no servidor: recalcular percentual e elegibilidade (≥ 15%) e descartar item inconsistente', 'M', 'I', 'deals', '-', '-', 'deals.test.ts')
add(D, 'flyer', 'Envio de encarte (PDF ou imagem) por gerente da rede, processado em segundo plano', 'S', 'P', 'deals', 'POST /deals/flyers', 'sem tela de envio', 'deals.test.ts')
add(D, 'flyerjson', 'Cadastro de encarte já estruturado (o chat lê o panfleto e envia as ofertas)', 'S', 'I', 'deals, mcp-server', 'POST /deals/flyers/structured', 'servidor MCP', 'deals-proximity.test.ts, mcp encarte.test.ts')
add(D, 'filial', 'Filial mais próxima da oferta, com distância e tempo de moto (OSRM, com estimativa de reserva)', 'S', 'I', 'deals, branches', 'GET /deals?lat&lng', '/ofertas-do-bairro', 'deals-proximity.test.ts, branches-routing.test.ts')
add(D, 'cupom', 'Reservar cupom de retirada válido por 24 h (um ativo por cliente e oferta; só oferta com desconto ≥ 15%)', 'M', 'I', 'deals', 'POST /deals/{id}/coupon', '/ofertas-do-bairro', 'deals.test.ts')
add(D, 'conf', 'Cliente confirma a compra do cupom (REDEEMED); confirmação dupla ou cupom vencido devolve 409', 'M', 'I', 'deals', 'POST /coupons/{id}/confirm', '/conta', 'deals.test.ts')
add(D, 'meus', 'Listar os cupons do cliente (vencido aparece como EXPIRED)', 'M', 'I', 'deals', 'GET /coupons/mine', '/conta', 'deals.test.ts')
add(D, 'imp-fil', 'Importar filiais de Fortaleza do OpenStreetMap, sem duplicar e sem apagar origem manual', 'C', 'I', 'branches', 'script `import-branches`', '-', 'branches-import.test.ts')
add(D, 'foto', 'Foto da oferta pelo produto do catálogo de nome mais parecido (`pg_trgm`)', 'C', 'I', 'deals', 'GET /deals', '/ofertas-do-bairro', 'deals.test.ts')
add(D, 'caixa', 'Baixa do cupom direto no caixa da rede (integração com a rede)', 'C', 'PL', '-', '-', '-', '-')
add(D, 'flyerui', 'Tela de envio de encartes no painel', 'C', 'PL', 'deals', 'POST /deals/flyers', '-', '-')

const PD = 'PDV (venda de balcão)'
add(PD, 'pdv', 'Venda de balcão: nasce concluída (canal POS, sem cliente), só com produtos da própria loja', 'S', 'P', 'pos, orders', 'POST /pos/sales', 'sem tela no painel', 'orders.flow.test.ts')
add(PD, 'pdvh', 'Histórico das vendas de balcão por canal', 'C', 'I', 'orders', 'GET /orders?channel=POS', '/pedidos', 'orders.flow.test.ts')
add(PD, 'pdvui', 'Interface de caixa (PDV) no painel', 'S', 'PL', 'pos', 'POST /pos/sales', '-', '-')

const AN = 'Análises'
add(AN, 'dash', 'Dashboard analítico com KPIs (faturamento, compras, ticket médio, lucro, conversão) e comparação ao período anterior', 'S', 'I', 'analytics', 'GET /analytics/dashboard', '/dashboard/analytics', 'analytics.test.ts')
add(AN, 'abc', 'Vendas por hora, curva ABC e formas de pagamento', 'S', 'I', 'analytics', 'GET /analytics/dashboard', '/dashboard/analytics', 'analytics.test.ts')
add(AN, 'canal', 'Divisão por canal (pedido online e cupom confirmado), ofertas e clientes mais lucrativos', 'S', 'I', 'analytics', 'GET /analytics/dashboard', '/dashboard/analytics', 'analytics.test.ts')
add(AN, 'funil', 'Funil da vitrine (visitas até pedidos) a partir de eventos anônimos', 'C', 'I', 'ops, analytics', 'POST /events', '/dashboard/analytics', 'ops.test.ts, analytics.test.ts')
add(AN, 'rel', 'Resumo de vendas por período (por dia, categoria e produtos mais vendidos)', 'S', 'I', 'reports', 'GET /reports/summary', '/dashboard, /relatorios', 'sem teste dedicado')
add(AN, 'clientes', 'Lista de clientes da loja derivada dos pedidos', 'C', 'I', 'orders', 'GET /orders', '/clientes', 'sem teste automatizado (front)')

const L = 'Logística'
add(L, 'lcfg', 'Configuração de entrega da loja (taxa, raio, frota própria ou pool)', 'S', 'I', 'delivery', 'GET e PUT /delivery/config', '/configuracoes, /entregas', 'delivery.test.ts')
add(L, 'ltaxa', 'Cotação no checkout: taxa e raio de entrega (fora do raio devolve 422)', 'S', 'I', 'delivery, orders', 'POST /orders', '/carrinho', 'delivery.test.ts')
add(L, 'lchamar', 'Chamar entregador do pool do bairro (convite de 2 min, busca em 5 km)', 'C', 'I', 'delivery', 'POST /delivery/deliveries', '/entregas', 'delivery.test.ts')
add(L, 'laceite', 'Aceite atômico da corrida: de vários entregadores, só um leva', 'S', 'I', 'delivery', 'POST /delivery/courier/deliveries/{id}/accept', '/entregador', 'delivery.test.ts, modulos-schema.test.ts')
add(L, 'lpin', 'Confirmação da entrega por PIN de 4 dígitos (5 erros travam; só o lojista libera; PIN apagado ao entregar)', 'S', 'I', 'delivery', 'POST .../deliver; POST .../unlock-pin', '/entregador, /acompanhar/:id', 'delivery.test.ts')
add(L, 'lgps', 'Rastreio por GPS (um ponto a cada 5 s), mapa para o cliente e retenção de 30 dias', 'C', 'I', 'delivery', 'PUT /delivery/courier/location; GET /delivery/orders/{id}', '/acompanhar/:id', 'delivery.test.ts')
add(L, 'lfrota', 'Frota própria: o lojista conduz saída e entrega pelo painel', 'C', 'I', 'delivery', 'POST /delivery/deliveries/{id}/own-fleet/*', '/entregas', 'delivery.test.ts')

const CD = 'Caderneta, encomendas, combos e prato do dia'
add(CD, 'cconta', 'Contas da caderneta (fiado) com limite e livro-razão só de inserção', 'S', 'I', 'credit', '/credit/accounts', '/caderneta', 'credit.test.ts')
add(CD, 'cfiado', 'Compra no fiado com limite validado por `UPDATE` atômico', 'S', 'I', 'credit, orders', 'POST /orders (`credit`)', '/carrinho', 'credit.test.ts')
add(CD, 'cbaixa', 'Baixa manual de pagamento e ajuste com nota', 'S', 'I', 'credit', 'POST /credit/accounts/{id}/payments e /adjustments', '/caderneta', 'credit.test.ts')
add(CD, 'clemb', 'Lembrete de cobrança com Pix copia e cola (BR Code) e link de WhatsApp', 'C', 'I', 'credit', 'POST /credit/accounts/{id}/reminder', '/caderneta', 'credit.test.ts')
add(CD, 'slots', 'Faixas de retirada e encomendas com antecedência por produto e sinal', 'C', 'I', 'scheduling', '/scheduling/*', '/agenda', 'scheduling.test.ts')
add(CD, 'vaga', 'Reserva atômica de vaga na faixa (lotação respeitada sob concorrência)', 'C', 'I', 'scheduling', 'POST /orders (`schedule`)', '/carrinho, /agenda', 'scheduling.test.ts, modulos-schema.test.ts')
add(CD, 'prato', 'Prato do dia com porções limitadas por dia e liga/desliga', 'C', 'I', 'daily-menu', '/daily-menu', '/prato-do-dia', 'scheduling.test.ts')
add(CD, 'combo', 'Combos de dois ou mais produtos da própria loja', 'C', 'I', 'daily-menu', '/combos', '/combos', 'scheduling.test.ts')

const V = 'Clube VIP'
add(V, 'vplano', 'Plano Vizinho VIP (R$ 14,90 por mês) com faixas de desconto por antiguidade', 'C', 'I', 'vip', 'GET /vip/plans', '/clube', 'vip.test.ts')
add(V, 'vassina', 'Assinar e cancelar a assinatura (provedor mock ou Asaas)', 'C', 'I', 'vip', 'POST /vip/subscribe; POST /vip/cancel', '/clube', 'vip.test.ts')
add(V, 'vhook', 'Webhook de pagamento idempotente e renovação por job', 'C', 'I', 'vip', 'POST /vip/webhooks/{provider}', '-', 'vip.test.ts')
add(V, 'vadesao', 'Adesão da loja ao Clube VIP com teto de desconto (até 30%) e frete grátis opcional', 'C', 'I', 'vip', 'GET, PUT, POST, DELETE /vip/merchant', '/clube-vip', 'vip.test.ts')
add(V, 'vdesc', 'Desconto VIP no preço do pedido (exceto oferta relâmpago) e frete grátis', 'C', 'I', 'vip, orders', 'POST /orders', '/carrinho', 'vip.test.ts')

const CI = 'Carrinho Inteligente'
add(CI, 'receita', 'Receitas públicas e privadas com ingredientes canônicos', 'C', 'I', 'smart-cart', 'GET /smart-cart/recipes', '/receitas, /receitas/:slug', 'smart-cart.test.ts')
add(CI, 'listas', 'Listas de compras do usuário (inclusive criadas a partir de receita)', 'C', 'I', 'smart-cart', '/smart-cart/lists', '/lista', 'smart-cart.test.ts')
add(CI, 'otimiza', 'Otimizador de menor custo entre lojas (itens mais frete, até 3 lojas, com desconto VIP)', 'C', 'I', 'smart-cart', 'POST /smart-cart/optimize', '/receitas/:slug, /lista', 'smart-cart.test.ts')
add(CI, 'canon', 'Itens canônicos e vínculo dos produtos da loja (manual e por heurística de nome)', 'C', 'I', 'smart-cart', '/smart-cart/canonicals; script `link-canonicals`', '-', 'smart-cart.test.ts')

const M = 'Servidor MCP do lojista'
add(M, 'mofertas', 'Ferramentas de ofertas do lojista: buscar produtos, listar, criar, atualizar, encerrar e resumir (relâmpago, prato do dia, combo)', 'C', 'I', 'mcp-server', 'API autenticada como o lojista', 'cliente MCP (chat)', 'mcp-server/test/tools.test.ts')
add(M, 'mencarte', 'Ferramentas `consultar_rede` e `cadastrar_ofertas_encarte`', 'C', 'I', 'mcp-server', 'POST /deals/flyers/structured', 'cliente MCP (chat)', 'mcp-server/test/encarte.test.ts')
add(M, 'mbairro', 'Ferramentas de consulta `listar_ofertas_do_bairro` e `listar_meus_cupons` (só leitura)', 'C', 'I', 'mcp-server', 'GET /deals; GET /coupons/mine', 'cliente MCP (chat)', 'mcp-server/test/ofertas-bairro.test.ts')

const I = 'Importação de catálogo e filiais'
add(I, 'icat', 'Importar o catálogo (437 produtos + 1.888 da ampliação em 24 departamentos), de forma idempotente', 'M', 'I', 'scripts/import-catalog', 'npm run import-catalog', '-', 'sem teste dedicado')
add(I, 'iseed', 'Gerar dados de demonstração de vendas (cerca de 30 dias) para o painel de Análises (só desenvolvimento)', 'C', 'I', 'scripts/seed-demo-sales', 'npm run seed-demo-sales', '/dashboard/analytics', 'sem teste dedicado')

const X = 'Planejado ou fora do escopo atual'
add(X, 'next', 'Migração do front para Next.js (adiada para depois do MVP, decisão de 16/11/2026)', 'W', 'PL', '-', '-', '-', '-')
add(X, 'wa', 'Envio automático de WhatsApp (hoje existe apenas o link `wa.me`)', 'W', 'PL', '-', '-', '-', '-')
add(X, 'lojaui', 'Tela para abrir loja a partir da conta de cliente', 'C', 'PL', 'auth', 'POST /auth/become-merchant', '-', '-')

const todos = G.map((r, i) => ({ ...r, id: `RF-${String(i + 1).padStart(3, '0')}` }))
const porKey = Object.fromEntries(todos.map((r) => [r.key, r]))
const rfId = (...keys) => keys.map((k) => { if (!porKey[k]) throw new Error('RF desconhecido: ' + k); return porKey[k].id }).join(', ')
const grupos = [...new Set(todos.map((r) => r.grupo))]
const ST = { I: 'Implementado', P: 'Parcial', PL: 'Planejado' }
const PR = { M: 'Must', S: 'Should', C: 'Could', W: "Won't (agora)" }
module.exports = { todos, grupos, rfId, ST, PR }
