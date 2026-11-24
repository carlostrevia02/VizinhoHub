'use strict'
const { h1, h2, h3, p, ul, ol, table, fig, box, land } = require('../modelo')
const { todos, grupos, rfId, ST, PR } = require('./dados-rf')

const us = (id, hist, crit, rf) => [id, hist, crit.map((c) => `• ${c}`).join('\n'), rfId(...rf)]

const historias = [
  us('US-01', 'Como **cliente**, quero me cadastrar com e-mail e senha, para fazer pedidos e guardar meus cupons.', ['Cadastro exige nome, e-mail válido e senha com 8 ou mais caracteres', 'E-mail já usado devolve erro 409 sem criar conta', 'Toda conta nova nasce como cliente'], ['reg', 'rbac']),
  us('US-02', 'Como **cliente**, quero entrar com minha conta Google, para não criar mais uma senha.', ['O login troca o ID token do Firebase por um token da API', 'Conta existente só é vinculada se o e-mail for verificado', 'Sem Firebase configurado a rota responde 501 e o login por senha segue valendo'], ['fb']),
  us('US-03', 'Como **cliente**, quero ver as ofertas dos supermercados perto de casa, para saber onde o produto está mais barato.', ['A lista traz rede, bairro, preço "de" e "por" e percentual de desconto', 'Posso filtrar por busca, bairro, rede, categoria e por ofertas com cupom', 'Ofertas não vistas há mais de 24 h não aparecem'], ['dlist']),
  us('US-04', 'Como **cliente**, quero ver a filial mais próxima de uma oferta com distância e tempo, para decidir se vale ir.', ['Ao informar minha localização, a oferta mostra a filial, a distância e o tempo de moto', 'Se o serviço de rotas falhar, a estimativa é calculada por linha reta', 'Sem localização, o campo vem vazio'], ['filial']),
  us('US-05', 'Como **cliente**, quero reservar um cupom de retirada, para garantir o preço da oferta no caixa da rede.', ['Só ofertas com desconto de 15% ou mais geram cupom', 'O cupom tem código curto e vale 24 horas', 'Não posso ter dois cupons ativos para a mesma oferta (409)'], ['cupom']),
  us('US-06', 'Como **cliente**, quero confirmar que comprei, para registrar minha economia.', ['A confirmação muda o cupom para REDEEMED com a data', 'Confirmar duas vezes ou depois de vencido devolve 409', 'Cupom de outro cliente devolve 404'], ['conf', 'meus']),
  us('US-07', 'Como **cliente**, quero ver produtos perto do vencimento com desconto, para economizar e evitar desperdício.', ['Produto que vence hoje ou amanhã mostra 50% de desconto; em até 3 dias, 30%', 'O preço original aparece riscado', 'Produto vencido não aparece na vitrine'], ['sv', 'svui']),
  us('US-08', 'Como **cliente**, quero buscar produtos por nome e departamento, para achar o que preciso sem acento ou caixa.', ['"acucar" encontra "Açúcar"', 'A lista é paginada e carrega mais ao rolar', 'Posso filtrar por departamento'], ['vitrine', 'cat']),
  us('US-09', 'Como **cliente**, quero montar um carrinho e enviar o pedido para uma loja, para retirar ou receber em casa.', ['O pedido tem produtos de uma única loja; misturar lojas devolve 422', 'O preço é calculado no servidor, nunca informado por mim', 'Pedido mínimo, retirada, entrega e formas de pagamento seguem a configuração da loja'], ['cart', 'pedido', 'regras']),
  us('US-10', 'Como **cliente**, quero acompanhar meu pedido em tempo real, para saber quando está pronto.', ['A tela muda de status sozinha quando o lojista avança o pedido', 'Só o dono do pedido e a loja o enxergam', 'Posso receber aviso por push quando o pedido fica pronto'], ['acomp', 'det', 'push']),
  us('US-11', 'Como **cliente**, quero ver ofertas relâmpago no radar, para aproveitar promoções curtas perto de mim.', ['O radar lista ofertas ativas dentro do raio, com preço, quantidade restante e prazo', 'Posso filtrar por categoria', 'Oferta vencida ou cancelada some'], ['radar']),
  us('US-12', 'Como **cliente**, quero comprar uma oferta relâmpago sem risco de ela já ter acabado, para não ser frustrado no caixa.', ['Se as unidades acabaram durante a compra, recebo 422 `FLASH_UNAVAILABLE`', 'O limite por cliente é respeitado (422 `FLASH_LIMIT`)', 'Cancelado o pedido, o saldo e o meu limite voltam'], ['fcompra', 'cancel']),
  us('US-13', 'Como **cliente**, quero ser avisado de ofertas relâmpago perto de casa, para não perder as boas.', ['O alerta tem raio, categorias e horário de silêncio', 'Recebo no máximo um aviso por oferta', 'Posso remover o alerta'], ['falerta']),
  us('US-14', 'Como **cliente**, quero assinar o Clube VIP, para ter desconto e frete grátis nas lojas aderentes.', ['O plano custa R$ 14,90 por mês e o desconto sobe com a antiguidade (2%, 4%, 6% e 8%)', 'O desconto vale só em loja aderente e não vale em oferta relâmpago', 'Posso cancelar no fim do período ou imediatamente'], ['vplano', 'vassina', 'vdesc']),
  us('US-15', 'Como **cliente**, quero transformar uma receita em lista de compras e ver onde sai mais barato, para economizar na cesta.', ['A receita vira lista com os ingredientes canônicos', 'O plano compara lojas somando itens e frete, com no máximo 3 lojas', 'O plano considera o desconto e o frete grátis do Clube VIP'], ['receita', 'listas', 'otimiza']),
  us('US-16', 'Como **comerciante**, quero ver o pedido chegar no painel na hora, para atender sem recarregar a tela.', ['O pedido aparece na coluna "Novos pedidos" com aviso sonoro', 'Só a loja dona do pedido recebe o evento', 'Se a conexão cair, o painel indica que o tempo real está fora'], ['kcreated', 'ws', 'alerta']),
  us('US-17', 'Como **comerciante**, quero mover o pedido entre as colunas do Kanban, para organizar o preparo.', ['A sequência é Pendente, Em preparação, Pronto, Entregue; cancelar só antes de ficar pronto', 'Transição inválida devolve 409 com as opções permitidas', 'Dois aceites simultâneos do mesmo pedido resultam em um aceite e um 409'], ['estados', 'cancel']),
  us('US-18', 'Como **comerciante**, quero imprimir a comanda do pedido, para o preparo no balcão.', ['A comanda de 80 mm entra numa fila persistida', 'Com o caixa offline, o trabalho espera e não imprime em dobro', 'Posso reimprimir (nova via)'], ['print']),
  us('US-19', 'Como **comerciante**, quero cadastrar e editar meus produtos, para manter o catálogo atualizado.', ['Preço maior que zero, nome obrigatório e validade não passada', 'Edição com versão antiga devolve 409', 'Remover o produto cancela as ofertas relâmpago dele'], ['crud', 'otim']),
  us('US-20', 'Como **comerciante**, quero criar uma oferta relâmpago, para vender rápido um item parado ou perto de vencer.', ['O preço precisa ser menor que o atual', 'Defino quantidade, limite por cliente, raio e duração (5 min a 12 h)', 'Só uma oferta viva por produto'], ['fcria', 'fedit']),
  us('US-21', 'Como **comerciante**, quero criar e ajustar ofertas conversando com a IA, para não preencher formulários no meio do expediente.', ['A IA busca o produto e cria a oferta com as regras da API', 'Erros da API voltam como mensagem clara', 'Relâmpago encerrada não volta: é criada outra'], ['mofertas']),
  us('US-22', 'Como **gerente de rede**, quero cadastrar o encarte da minha rede a partir da foto ou do PDF, para publicar as ofertas.', ['Só gerente cadastrado na rede pode enviar (403 `NOT_CHAIN_MANAGER`)', 'O servidor valida cada oferta e informa as descartadas e o motivo', 'Posso acrescentar páginas sem apagar as anteriores'], ['flyer', 'flyerjson', 'mencarte']),
  us('US-23', 'Como **comerciante**, quero ver meu faturamento, lucro e ofertas campeãs, para decidir o que promover.', ['Os KPIs comparam com o período anterior', 'O lucro vem só de cupons confirmados', 'Posso ver vendas por hora, curva ABC e pagamentos'], ['dash', 'abc', 'canal']),
  us('US-24', 'Como **comerciante**, quero controlar a caderneta (fiado) dos clientes, para vender a prazo com limite.', ['A conta tem limite e o saldo nunca passa dele, mesmo com compras simultâneas', 'Registro pagamentos e ajustes; o livro só recebe lançamentos', 'Posso gerar um lembrete com Pix copia e cola'], ['cconta', 'cfiado', 'cbaixa', 'clemb']),
  us('US-25', 'Como **comerciante**, quero aceitar encomendas por faixa de horário, para organizar a produção.', ['Produto sob encomenda exige agendamento com a antecedência mínima', 'A faixa tem capacidade e não aceita reservas além dela', 'Cancelar o pedido libera a vaga'], ['slots', 'vaga']),
  us('US-26', 'Como **comerciante**, quero publicar o prato do dia e combos, para vender pratos prontos em quantidade limitada.', ['O prato tem porções do dia e liga/desliga', 'Pedidos simultâneos não vendem mais porções do que existem', 'Combo exige ao menos dois produtos da minha loja'], ['prato', 'combo']),
  us('US-27', 'Como **comerciante**, quero configurar entrega, taxa, raio e horário, para atender no meu ritmo.', ['Defino entrega e retirada, pedido mínimo e formas de pagamento', 'Pedido fora do raio de entrega devolve 422', 'Posso usar frota própria ou chamar entregador do bairro'], ['loja', 'lcfg', 'ltaxa']),
  us('US-28', 'Como **entregador**, quero aceitar uma corrida e confirmar a entrega com o PIN do cliente, para comprovar que entreguei.', ['Entre vários entregadores, só um leva a corrida', 'Cinco PINs errados travam a entrega; só o lojista libera', 'Minha posição é enviada no máximo a cada 5 s e apagada após 30 dias'], ['laceite', 'lpin', 'lgps']),
  us('US-29', 'Como **gerente do VizinhoHub**, quero que a plataforma sobreviva a dados ruins da IA, para não publicar preço errado.', ['Percentual e elegibilidade são recalculados no servidor', '"Por" maior ou igual a "de" ou desconto acima de 90% descarta a oferta', 'Página sem ofertas não apaga as existentes'], ['dval', 'dscan']),
]

module.exports = () => {
  const out = []
  out.push(h1('Levantamento de requisitos'))
  out.push(box('Como ler este capítulo', [
    'A documentação anterior do projeto não tinha identificadores de requisito. Os IDs **RF-**, **RNF-**, **RN-** e **US-** foram criados neste relatório, em um único passe, a partir da documentação e da conferência do código. A coluna "Situação" foi verificada no código em 23/11/2026.',
    'Pesquisa de campo (entrevistas e oficinas) não está registrada no repositório. Por isso, as personas abaixo são **arquétipos** construídos pelo autor; não descrevem pessoas entrevistadas.',
  ], { kind: 'warn' }))

  out.push(h2('Stakeholders'))
  out.push(table('Partes interessadas', ['Parte interessada', 'Interesse', 'Relação com o sistema'], [
    ['Comerciante (dono de mercadinho)', 'Visibilidade, pedidos organizados, controle simples e sem comissão', 'Usuário do painel (Manager) e do servidor MCP'],
    ['Consumidor (morador do bairro)', 'Achar o melhor preço perto de casa e comprar com segurança', 'Usuário da vitrine (Store)'],
    ['Entregador autônomo', 'Receber corridas do bairro e comprovar a entrega', 'Usuário da área `/entregador`'],
    ['Gerente de rede ou parceiro', 'Publicar o encarte da rede', 'Envio por API ou chat (MCP)'],
    ['Redes de supermercado', 'Divulgar ofertas e atrair clientes', 'Fonte das ofertas; o caixa não está integrado'],
    ['Universidade e docente da disciplina', 'Formação do estudante e impacto na comunidade', 'Avaliação do projeto de extensão'],
    ['Provedores de serviço (Firebase, Claude API, OSRM, Asaas, Render, Vercel)', 'Uso dentro de seus termos', 'Dependências externas por adapters'],
  ], { w: [0.3, 0.4, 0.3], size: 'sm' }))

  out.push(h2('Personas'))
  out.push(table('Personas (arquétipos)', ['Persona', 'Perfil', 'Objetivos', 'Dores', 'Resposta do sistema'], [
    ['**Zé**, comerciante', 'Dono do "Mercadinho do Zé" (loja de exemplo do seed, Aldeota). Atende no balcão e no WhatsApp', 'Vender mais, divulgar promoções do dia, saber o que vendeu', 'Pedido se perde em mensagens; caderno de fiado; sem tempo para sistemas complexos', 'Kanban em tempo real, ofertas relâmpago, caderneta, análises, ofertas pelo chat (MCP)'],
    ['**Maria**, cliente', 'Moradora do bairro (cliente de exemplo do seed). Compra a cesta da semana', 'Pagar menos, não perder promoção, retirar perto', 'Encartes espalhados; não sabe qual loja está mais barata', 'Ofertas do bairro com cupom, radar, Salva-Estoque, plano de menor custo'],
    ['**Entregador**', 'Autônomo da região, com moto ou bicicleta', 'Receber corridas próximas e comprovar entrega', 'Falta de prova de entrega; corrida disputada', 'Pool do bairro, aceite atômico, PIN, rastreio'],
    ['**Gerente de rede**', 'Responsável por uma rede de supermercados cadastrada', 'Publicar o encarte da rede sem retrabalho', 'Encarte em imagem ou PDF difícil de digitalizar', 'Envio de encarte; leitura e validação das ofertas'],
  ], { w: [0.13, 0.22, 0.2, 0.22, 0.23], size: 'xs' }))

  out.push(h2('Histórias de usuário'))
  out.push(p(`São **${historias.length} histórias** no formato "Como… quero… para…", com critérios de aceite verificáveis. A última coluna aponta os requisitos funcionais que a atendem.`))
  out.push(table('Histórias de usuário e critérios de aceite', ['ID', 'História', 'Critérios de aceite', 'RF'], historias, { w: [0.07, 0.33, 0.47, 0.13], size: 'xs', key: 'us' }))

  out.push(h2('Requisitos funcionais'))
  out.push(p('Prioridade pelo método MoSCoW (Must, Should, Could, Won\'t agora). A situação é **Implementado** (existe no código e, em geral, tem teste), **Parcial** (existe parte, em geral só na API) ou **Planejado** (ainda não existe).'))
  for (const g of grupos) {
    const rows = todos.filter((r) => r.grupo === g).map((r) => [r.id, r.desc, PR[r.p], ST[r.st]])
    out.push(h3(g))
    out.push(table(`Requisitos funcionais: ${g}`, ['ID', 'Requisito', 'Prioridade', 'Situação'], rows, { w: [0.1, 0.62, 0.13, 0.15], size: 'sm' }))
  }
  const cont = (k) => todos.filter((r) => r.st === k).length
  out.push(table('Resumo da situação dos requisitos funcionais', ['Situação', 'Quantidade'], [
    ['Implementado', String(cont('I'))], ['Parcial', String(cont('P'))], ['Planejado', String(cont('PL'))], ['**Total**', `**${todos.length}**`],
  ], { w: [0.5, 0.5], size: 'sm' }))

  out.push(h2('Requisitos não funcionais'))
  const rnf = [
    ['Desempenho', 'RNF-001', 'Respostas comprimidas em gzip (o catálogo de cerca de 1,4 MB cai para cerca de 10% na rede)', 'commit 9.11; `compression` em `app.ts`'],
    ['Desempenho', 'RNF-002', 'Índices para o Kanban, busca por nome (`pg_trgm`) e análises; listas paginadas (até 500 produtos e 200 pedidos por página)', '`schema.sql`; `products.schema.ts`'],
    ['Desempenho', 'RNF-003', 'Vitrine com rolagem infinita e carregamento preguiçoso de imagens', 'commit 9.10; `LazyGrid.jsx`'],
    ['Desempenho', 'RNF-004', 'Sob concorrência, 30 clientes disputando 5 unidades vendem exatamente 5', '`modulos-schema.test.ts`, `flash.test.ts`'],
    ['Segurança', 'RNF-005', 'Token JWT HS256 de 7 dias; em produção o segredo precisa ter 32 ou mais caracteres e não pode parecer padrão', '`auth.ts`, `env.ts`'],
    ['Segurança', 'RNF-006', 'Senhas com hash `scrypt` e sal próprio; verificação em tempo constante e hash fictício para e-mail inexistente', '`password.ts`, `auth.service.ts`'],
    ['Segurança', 'RNF-007', 'Toda entrada validada com zod; erros no envelope `{ error: { code, message, details } }`', '`errors.ts`, `*.schema.ts`'],
    ['Segurança', 'RNF-008', 'CORS restrito às origens configuradas; em produção `localhost` é recusado', '`env.ts`'],
    ['Segurança', 'RNF-009', 'Limites de taxa: login e cadastro 20 por 15 min, envio de encarte 30 por hora, telemetria 240 por minuto (contador em memória, válido para uma instância)', '`rate-limit.ts`, rotas'],
    ['Segurança', 'RNF-010', 'Conteúdo de páginas externas tratado como dado não confiável (prompt e schema de saída restritos)', '`deals.extractor.ts`'],
    ['Segurança', 'RNF-011', 'A API recusa subir em produção se existirem contas de desenvolvimento (`@vizinhohub.test`)', '`server.ts`'],
    ['LGPD', 'RNF-012', 'Retenção: GPS do entregador 30 dias; funil da vitrine 90 dias; pedidos e caderneta 5 anos; PIN apagado na entrega', '`orders.retention.ts`, `ops.jobs.ts`, `delivery.jobs.ts`'],
    ['LGPD', 'RNF-013', 'Minimização: o arquivo do encarte não é guardado (só o extraído); o lucro da plataforma nunca é devolvido ao cliente no MCP', '`deals.flyers.ts`, README do MCP'],
    ['Usabilidade', 'RNF-014', 'Interface mobile-first e PWA instalável', '`manifest.webmanifest`, `sw.js`'],
    ['Usabilidade', 'RNF-015', 'Erros em português, por código e por campo (tradução das mensagens do zod)', '`apps/web/src/lib/api.js`'],
    ['Usabilidade', 'RNF-016', 'Datas, validades e horários no fuso America/Fortaleza', '`schema.sql`, `time.ts` do MCP'],
    ['Disponibilidade', 'RNF-017', 'Rota `/health`; reconexão do WebSocket no cliente; LISTEN do catálogo com reconexão (1 a 30 s)', '`app.ts`, `realtime.js`, `catalog-live.ts`'],
    ['Disponibilidade', 'RNF-018', 'Falha ao avisar por WebSocket nunca desfaz nem falha um pedido já gravado', '`orders.service.ts`'],
    ['Disponibilidade', 'RNF-019', 'Encerramento limpo no SIGTERM; varredura de ofertas única entre instâncias (`pg_try_advisory_lock`)', '`server.ts`, `deals.scanner.ts`'],
    ['Manutenibilidade', 'RNF-020', 'Backend em camadas por módulo (schema, repository, service, routes) e contratos compartilhados', '`apps/api/src/modules`, `packages/contracts`'],
    ['Manutenibilidade', 'RNF-021', 'OpenAPI gerado do código e testado contra as rotas montadas no Express', '`openapi.test.ts`'],
    ['Manutenibilidade', 'RNF-022', 'Migrações idempotentes e testes de integração com Postgres real embutido', '`db/migrations`, `test/helpers.ts`'],
    ['Portabilidade', 'RNF-023', 'Sem Docker: Render, Vercel ou Cloudflare Pages, ou VPS com PM2; Postgres embutido em desenvolvimento', '`render.yaml`, `ecosystem.config.cjs`'],
    ['Portabilidade', 'RNF-024', 'Dependências externas atrás de adapters substituíveis (provedor de pagamento, roteador, extrator de ofertas)', '`vip/payments`, `routing.ts`, `deals.extractor.ts`'],
    ['Observabilidade', 'RNF-025', 'Log dos jobs, estado de cada fonte (`last_status`, `last_error`), auditoria dos encartes e livro da caderneta só de inserção', '`jobs.ts`, `deal_sources`, `flyer_uploads`, `credit_ledger`'],
  ]
  out.push(table('Requisitos não funcionais', ['Categoria', 'ID', 'Requisito', 'Evidência'], rnf, { w: [0.14, 0.09, 0.5, 0.27], size: 'xs', key: 'rnf' }))
  out.push(p('Limite reconhecido: não há métricas, tracing nem logs estruturados (os logs são texto no stdout, gravados em arquivo pelo PM2). Também não foi medido o desempenho sob carga real de usuários.'))

  out.push(h2('Regras de negócio'))
  const rn = [
    ['RN-01', 'Desconto de 15% ou mais torna a oferta elegível a cupom', '`COUPON_MIN_PCT` em `deals.schema.ts`'],
    ['RN-02', 'O cupom vale 24 horas e guarda o preço "por" e o preço base "de" no momento da reserva', '`COUPON_TTL_HOURS` em `deals.service.ts`'],
    ['RN-03', 'Um cupom ativo por cliente e oferta', 'índice `uq_coupons_active`'],
    ['RN-04', 'Oferta com "por" maior ou igual a "de", desconto acima de 90% ou categoria/unidade fora da lista é descartada', '`parseExtraction`'],
    ['RN-05', 'Oferta não vista há mais de 24 h (sem validade informada) some da API; página vazia não apaga as existentes', '`LIVE` em `deals.repository.ts`; `deals.scanner.ts`'],
    ['RN-06', 'Só a confirmação do cliente transforma o cupom em venda e lucro (um único `UPDATE` condicional)', '`confirmCoupon`'],
    ['RN-07', 'Lucro do cupom = (preço base − preço do encarte) × quantidade mínima', '`COUPON_SQL` em `deals.repository.ts`'],
    ['RN-08', 'Salva-Estoque: 50% se vence hoje ou amanhã, 30% em até 3 dias; vencido não é vendável', 'função `clearance_discount_pct`'],
    ['RN-09', 'Estados do pedido: PENDING → IN_PREPARATION → READY → COMPLETED; CANCELLED a partir de PENDING e IN_PREPARATION; o resto é 409', '`TRANSITIONS` em `orders.service.ts`'],
    ['RN-10', 'Um pedido tem produtos de uma única loja', '`MULTIPLE_MERCHANTS`'],
    ['RN-11', 'O preço do pedido é sempre calculado no servidor; `unit_price` guarda o preço no momento da compra', '`orders.service.ts`; `order_items`'],
    ['RN-12', 'O mesmo produto não entra no pedido ao preço normal e em oferta ao mesmo tempo', '`FLASH_PRODUCT_CONFLICT`'],
    ['RN-13', 'Relâmpago: preço menor que o atual; 1 a 1000 unidades; duração de 5 a 720 min; limite por cliente de 1 a 20 (padrão 2); raio de 100 m a 10 km (padrão 2 km); uma oferta viva por produto; a loja precisa ter localização', '`packages/contracts/src/flash.ts`; `flash.service.ts`'],
    ['RN-14', 'Editar relâmpago: quantidade não pode ficar abaixo do vendido; prazo no futuro e até 12 h após o início', '`flash.service.ts` (`update`)'],
    ['RN-15', 'Cancelar o pedido devolve saldo da oferta, limite do cliente, porções do prato do dia, vaga da faixa e estorna o fiado', '`orders.service.ts` (`updateStatus`)'],
    ['RN-16', 'Aceitar ou cancelar pedido não mexe em estoque: o produto não tem saldo (só a oferta tem)', 'migração 019'],
    ['RN-17', 'Entrega só dentro do raio configurado pela loja (senão 422); a taxa é a da loja', '`delivery.quote.ts`'],
    ['RN-18', 'PIN de 4 dígitos; 5 erros travam a entrega; só o lojista libera (e troca o PIN); apagado ao entregar', '`delivery.service.ts` (`MAX_PIN_ATTEMPTS`)'],
    ['RN-19', 'Convite de corrida vale 2 minutos e busca entregadores em 5 km', '`OFFER_TTL_MIN`, `COURIER_SEARCH_RADIUS_M`'],
    ['RN-20', 'Posição do entregador: no máximo uma a cada 5 s; trilha apagada após 30 dias', '`delivery.test.ts`; `LOCATION_RETENTION_DAYS`'],
    ['RN-21', 'Fiado: saldo mais compra não passa do limite; pagamento não passa da dívida; ajuste não deixa a dívida negativa; livro só recebe inserção', '`credit.ledger.ts`'],
    ['RN-22', 'Encomenda: antecedência por produto, faixa de retirada com capacidade, sinal não maior que o total', '`scheduling.booking.ts`'],
    ['RN-23', 'Prato do dia: porções por dia, baixa atômica, devolução no cancelamento', '`daily-menu.claims.ts`'],
    ['RN-24', 'Combo exige ao menos dois componentes distintos, da própria loja', '`scheduling.test.ts`'],
    ['RN-25', 'VIP: R$ 14,90 por mês; desconto 2% (1º mês), 4% (3º), 6% (6º), 8% (12º); vale o menor entre a faixa e o teto da loja (até 30%); relâmpago não recebe; frete grátis exige adesão da loja e pedido mínimo de R$ 30,00', '`vip.discount.ts`; `schema.sql`'],
    ['RN-26', 'Assinatura vencida entra em carência de 3 dias antes de expirar; o mesmo evento do provedor tem efeito único', '`GRACE_DAYS`; `vip.test.ts`'],
    ['RN-27', 'Carrinho Inteligente: custo = itens + frete de cada loja usada; até 3 lojas candidatas entre as mais próximas', '`smart-cart.optimizer.ts`'],
    ['RN-28', 'Encarte: só gerente cadastrado da rede; PDF até 20 MB, imagem até 5 MB; validade de 1 a 30 dias (padrão 7)', '`deals.flyers.ts`; `retail_chain_managers`'],
    ['RN-29', 'O papel nunca vem do token nem do corpo; todo cadastro público nasce cliente', '`auth.service.ts`'],
    ['RN-30', 'Recurso de outra loja devolve 404 (não revela que existe)', '`orders.service.ts`, demais módulos'],
    ['RN-31', 'Produto: preço maior que zero (até R$ 1.000.000, 2 casas), validade não passada, código de barras de 8 a 14 dígitos', '`products.schema.ts`'],
    ['RN-32', 'Alerta "perto de casa": raio de 200 m a 5 km (padrão 1,5 km); um aviso por pessoa e oferta; horário silencioso opcional', '`flash.ts`; `offer_notifications`'],
    ['RN-33', 'Filial "já estou na loja" a 50 m; rota por OSRM com reserva por linha reta × 1,35', '`branches.service.ts`; `routing.ts`'],
  ]
  out.push(table('Regras de negócio e onde estão no código', ['ID', 'Regra', 'Fonte'], rn, { w: [0.08, 0.65, 0.27], size: 'xs', key: 'rn' }))

  out.push(h2('Restrições e fora de escopo'))
  out.push(h3('Restrições'))
  out.push(ul([
    '**Autor único e prazo curto:** um estudante, uma disciplina, de 29/09 a 30/11/2026.',
    '**Sem custódia de valores:** a plataforma não retém dinheiro de terceiros; pagamentos do Clube VIP passam por provedor externo e a caderneta é apenas livro-razão.',
    '**Sem integração com o caixa das redes:** o cupom é uma reserva de preço; a baixa depende de parceria.',
    '**Dependência de serviços externos:** Claude API (leitura de ofertas), OSRM público (rotas), Firebase (login Google, opcional), Asaas (opcional).',
    '**Stack definida:** Node 24, TypeScript, Express 5, PostgreSQL e React; hospedagem sem Docker.',
  ]))
  out.push(h3('Fora de escopo'))
  out.push(ul([
    '**Estoque de produto:** o VizinhoHub não tem filial nem mercadoria própria; produto não tem saldo (decisão de 20/11/2026, commits 13.x).',
    '**Rede B2B entre mercadinhos** (busca de excedente e alertas de ruptura): removida do código no commit 13.1.',
    '**Departamentos e Encartes no Manager:** removidos da interface do painel (commit 13.3); encartes seguem por API e chat.',
    '**Pagamento custodiado e marketplace com split:** fora do modelo de negócio.',
    '**Envio automático de WhatsApp:** hoje há apenas o link `wa.me`.',
    '**Migração para Next.js:** adiada para depois do MVP.',
  ]))

  out.push(fig('19-mapa-mental-requisitos', 'Mapa mental dos requisitos: módulos funcionais e requisitos não funcionais.'))

  out.push(h2('Matriz de rastreabilidade'))
  out.push(p('A matriz liga cada requisito funcional ao módulo da API, à rota, à tela e ao teste que o exercita. "Sem teste" indica ausência de teste automatizado dedicado, não de funcionamento.'))
  const lines = todos.filter((r) => r.st !== 'PL').map((r) => [r.id, r.desc.length > 70 ? r.desc.slice(0, 67).replace(/\s+\S*$/, '') + '…' : r.desc, r.api, r.rota, r.tela, r.teste])
  const half = Math.ceil(lines.length / 2)
  out.push(land([
    table('Matriz de rastreabilidade RF → módulo da API → rota → tela → teste (1 de 2)', ['RF', 'Requisito (resumo)', 'Módulo da API', 'Rota', 'Tela', 'Teste'], lines.slice(0, half), { w: [0.06, 0.26, 0.12, 0.2, 0.15, 0.21], size: 'xs', key: 'mat1' }),
    table('Matriz de rastreabilidade RF → módulo da API → rota → tela → teste (2 de 2)', ['RF', 'Requisito (resumo)', 'Módulo da API', 'Rota', 'Tela', 'Teste'], lines.slice(half), { w: [0.06, 0.26, 0.12, 0.2, 0.15, 0.21], size: 'xs', key: 'mat2' }),
  ]))
  return out
}
