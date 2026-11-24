'use strict'
const { h1, h2, h3, p, ul, table, fig, box } = require('../modelo')
const F = require('./fatos')

module.exports = () => [
  h1('Arquitetura'),
  p(`O VizinhoHub é um **monorepo** com três aplicações e um pacote compartilhado: \`apps/api\` (Core API e jobs), \`apps/web\` (vitrine e painel, um só aplicativo React), \`apps/mcp-server\` (ferramentas para a IA do comerciante) e \`packages/contracts\` (schemas zod, DTOs e eventos). O banco fica em \`db/\`. A arquitetura foi desenhada para um autor único e hospedagem barata: um processo de API, um PostgreSQL e um front estático.`),

  h2('Visão de contexto (C4, nível 1)'),
  fig('05-contexto-c4', 'Diagrama de contexto (C4 nível 1): pessoas, o VizinhoHub e os sistemas externos.'),
  p('O sistema serve cinco tipos de pessoa (cliente, comerciante, entregador, gerente de rede e a IA que opera pelo MCP) e depende de serviços externos opcionais: Firebase Auth (login Google), Claude API (leitura das ofertas), OSRM/OpenStreetMap (rotas e mapas), Asaas (assinatura do Clube VIP) e WhatsApp, que hoje é apenas um link `wa.me` aberto pelo usuário. As redes de supermercado são fonte de ofertas; não há integração com o caixa delas.'),

  h2('Containers (C4, nível 2)'),
  fig('06-containers-c4', 'Diagrama de containers (C4 nível 2): Web PWA, Core API, PostgreSQL, servidor MCP e pacote de contratos.'),
  p('A **Core API** concentra o REST em `/api/v1`, o canal Socket.io e os jobs agendados no mesmo processo. O **PostgreSQL** guarda tudo, inclusive regras (funções e views) e a fila de impressão. O **Web PWA** é estático e fala com a API por HTTP e WebSocket. O **servidor MCP** é um processo separado que usa a API autenticada como o comerciante, sem acessar o banco. O pacote **contracts** é importado pelos três.'),

  h2('Camadas do back-end'),
  fig('07-camadas-backend', 'Camadas do back-end: rotas, serviços, repositórios, schemas e eventos.', { maxH: 820 }),
  p(`Cada módulo de \`apps/api/src/modules\` (${F.modulosApi} no total) segue o mesmo formato: **schema** (zod) valida a entrada, **routes** só traduz HTTP, **service** decide as regras e **repository** executa o SQL. O código compartilhado fica em \`shared/\` (autenticação, banco, erros, jobs, limites de taxa, tempo real). Esse padrão repete o do módulo de pedidos e mantém as regras testáveis sem subir o servidor HTTP: os testes de integração chamam o serviço e o Express com Postgres real.`),

  h2('Decisões arquiteturais (ADR)'),
  box('Origem destas decisões', [
    'O repositório **não contém arquivos de ADR**. Os registros abaixo são **reconstruções** feitas para este relatório a partir da seção 8 do documento 10 (decisões de 16/11/2026), da decisão de 20/11/2026 (VizinhoHub é intermediário de descontos), dos comentários do código e do histórico do git. O texto de "contexto" e "consequências" é interpretação do autor deste relatório e deve ser confirmado pelo autor do projeto.',
  ], { kind: 'warn' }),
  table('Registros de decisões arquiteturais (reconstruídos)', ['ID', 'Decisão', 'Contexto', 'Consequências', 'Origem'], [
    ['ADR-01', 'Front em React + Vite como PWA separado; Next.js adiado para depois do MVP', 'A API já existia e o prazo era curto; migrar de framework competiria com entregar funcionalidade', 'Menos reescrita; contratos em pacote próprio mantêm a migração futura barata; sem renderização no servidor', 'Doc. 10, seção 8 (16/11)'],
    ['ADR-02', 'Manter a API em Express + Socket.io no mesmo processo', 'WebSocket persistente não roda em funções serverless; a API já tinha pedidos, auth, jobs e testes', 'Um processo só para REST, tempo real e jobs; escalar para várias instâncias exige cuidado (por isso a varredura usa trava no banco)', 'Doc. 10, seção 2'],
    ['ADR-03', 'SQL puro com `pg` (sem ORM)', 'A correção sob concorrência depende de `UPDATE` condicional e `ON CONFLICT … WHERE`, que ORMs escondem', 'Controle total do SQL e das transações; mais código de repositório; o plano original citava Prisma e foi abandonado', 'Código (`apps/api`); doc. 04 desatualizado'],
    ['ADR-04', 'O `UPDATE` condicional é o lock; `FOR UPDATE` só quando é preciso ler antes', 'Quantidade limitada e dinheiro exigem que a decisão seja do banco, sem ler-e-gravar', 'Nenhuma venda além da oferta; testes com 6 a 30 transações simultâneas; padrão único em todo lugar', 'Doc. 10, seção 4'],
    ['ADR-05', 'Contratos (zod, DTOs e eventos) em `packages/contracts`', 'Três consumidores (API, web, MCP) precisam do mesmo formato', 'Mudança de formato quebra o build, não a produção; dependência `file:` entre pacotes', 'Doc. 10, seção 2; código'],
    ['ADR-06', 'Clube VIP com adapter de pagamento e webhook idempotente, sem custódia', 'Evitar guardar dinheiro de terceiros e depender de um gateway só', '`VIP_PROVIDER=mock|asaas`; evento do provedor tem efeito único; Pix recorrente depende do gateway escolhido', 'Doc. 10, seção 8.2'],
    ['ADR-07', 'Caderneta somente como livro-razão e lembrete', 'Intermediar crédito traria obrigação regulatória e risco', 'O lojista dá baixa manual; o livro só recebe inserções; o saldo é sempre explicável', 'Doc. 10, seção 8.3'],
    ['ADR-08', 'Entregador é um perfil (`couriers`) de usuário comum, não um papel novo', 'Evitar alterar toda checagem de `MERCHANT` e `CUSTOMER`', 'Nenhum código de papel mudou; "ser entregador" é ter linha em `couriers`', 'Doc. 10, seção 3'],
    ['ADR-09', 'O VizinhoHub é intermediário de descontos: sem estoque de produto, B2B, Departamentos e Encartes no painel', 'A plataforma não tem filial nem mercadoria própria; controlar saldo seria inconsistente com o negócio', 'Removidos do código e da interface (commits 13.x, migração 019); só a oferta relâmpago e o prato do dia têm quantidade; restam vestígios no schema', 'Decisão de 20/11/2026; commits 13.x'],
    ['ADR-10', 'A IA nunca é fonte de verdade: o servidor recalcula percentual e elegibilidade e descarta item inconsistente', 'Modelos erram e a página lida pode conter instruções maliciosas', 'Conteúdo tratado como dado não confiável; saída restrita por schema; página vazia não apaga ofertas', 'Código (`deals`); doc. 09'],
    ['ADR-11', 'Implantação sem Docker (Render, Vercel ou Cloudflare Pages, ou VPS com PM2)', 'Simplicidade e custo; Postgres embutido em desenvolvimento', 'Menos paridade entre ambientes; `tsx` roda a API em TypeScript direto; o plano dos serviços precisa ser conferido antes do primeiro deploy', 'Commits 7.x; `render.yaml`; `ecosystem.config.cjs`'],
    ['ADR-12', 'Vitrine em tempo real por `LISTEN/NOTIFY` do Postgres e namespace público `/catalog`', 'Mudanças de catálogo devem aparecer sem recarregar, sem fila externa', 'Evento enxuto (`catalog:changed`); reconexão do `LISTEN` com espera de 1 a 30 s', 'Commits 9.x; `catalog-live.ts`'],
  ], { w: [0.07, 0.22, 0.25, 0.28, 0.18], size: 'xs', key: 'adr' }),

  h2('Tempo real'),
  p('O canal Socket.io roda no mesmo processo da API, com o handshake autenticado por JWT (conexão sem token é recusada). Cada cliente entra em salas por identidade: `merchant:<id>` (pedidos novos e mudanças da loja), `customer:<id>` (status dos seus pedidos), `courier:<id>` (convites de corrida) e `delivery:<id>` (posição do entregador, para o cliente que acompanha). O namespace `/catalog` é público e só avisa que o catálogo mudou.'),
  table('Eventos de tempo real', ['Evento', 'Sala ou namespace', 'Quando', 'Payload'], [
    ['`order:created`', '`merchant:<id>`', 'Pedido criado', 'Pedido (DTO)'],
    ['`order:status_updated`', '`merchant:<id>` e `customer:<id>`', 'Mudança de status; também ao concluir a entrega', 'Pedido (DTO)'],
    ['`print:job`', '`merchant:<id>`', 'Comanda entra na fila de impressão', 'Trabalho de impressão (DTO)'],
    ['`delivery:offered`', '`courier:<id>`', 'Convite de corrida a entregador do pool', 'Convite (DTO)'],
    ['`delivery:location`', '`delivery:<id>`', 'Ponto de GPS do entregador (no máximo a cada 5 s)', 'Coordenadas e horário'],
    ['`catalog:changed`', 'namespace `/catalog`', 'Mudança de catálogo notificada pelo Postgres (`NOTIFY`)', 'Sem dados (a tela recarrega)'],
  ], { w: [0.2, 0.25, 0.33, 0.22], size: 'sm', key: 'eventos' }),
  p('Há dois cuidados de projeto. Primeiro, a emissão é feita **depois** da gravação e é isolada em `try/catch`: se o WebSocket falhar, o pedido já gravado não é desfeito. Segundo, a tela do painel mostra um indicador de conexão ao vivo e, se a conexão cair, o usuário percebe e recarrega; o cliente reconecta sozinho.'),

  h2('Concorrência: casos, instruções atômicas e resultados medidos'),
  p('A regra de projeto é única: **a decisão é do banco**. Em vez de ler o saldo e depois gravar (onde duas requisições passam juntas), cada caso usa uma instrução condicional que altera a linha apenas se a regra ainda vale; a linha fica travada até o `COMMIT`. Os resultados abaixo são de testes de integração com 6 a 30 transações simultâneas e estão descritos no documento 10 (seção 4) e nos testes `modulos-schema.test.ts`, `flash.test.ts`, `credit.test.ts`, `scheduling.test.ts` e `delivery.test.ts`.'),
  table('Concorrência: caso, instrução atômica e resultado medido', ['Caso', 'Instrução atômica', 'Resultado medido'], [
    ['Oferta relâmpago', '`UPDATE flash_offers SET qty_available = qty_available - q WHERE … AND qty_available >= q`, e depois o consumo do cliente por `ON CONFLICT … WHERE qty + q <= limite`, nessa ordem (evita deadlock)', '30 clientes, 5 unidades: **vendeu 5**'],
    ['Limite por cliente', '`INSERT … ON CONFLICT DO UPDATE … WHERE`', '6 tentativas, limite 2: **2 passam**; o rollback devolve o resto'],
    ['Fiado', '`UPDATE credit_accounts SET balance = balance + v WHERE balance + v <= credit_limit`', '20 compras de R$ 10, limite R$ 100: **10 passam**; saldo igual à soma do livro'],
    ['Vaga de encomenda', '`INSERT … ON CONFLICT DO UPDATE … WHERE booked < capacity`', '10 reservas, capacidade 3: **3 entram**'],
    ['Prato do dia', '`UPDATE daily_menu … WHERE is_on AND qty_available >= q`', '10 pedidos, 4 porções: **4 vendem**'],
    ['Aceite de corrida', '`UPDATE deliveries SET courier_id = c WHERE courier_id IS NULL`', '8 entregadores: **1 leva**'],
    ['Cupom (confirmação)', '`UPDATE deal_coupons SET status = \'REDEEMED\' … WHERE id = $1 AND customer_id = $2 AND status = \'ACTIVE\' AND expires_at > now()`', 'Confirmação dupla ou vencida devolve 409; de dois cliques simultâneos só um altera a linha (teste `deals.test.ts`)'],
    ['Edição de produto', '`WHERE id = $1 AND version = $2` com `version + 1` (bloqueio otimista)', '0 linhas alteradas vira HTTP 409'],
  ], { w: [0.17, 0.5, 0.33], size: 'sm', key: 'conc' }),
  p('A baixa de venda não usa `version`, para não competir com as edições do lojista. A mudança de status do pedido usa `SELECT … FOR UPDATE` porque precisa **ler** o estado atual antes de decidir a transição.'),

  h2('Tecnologias'),
  table('Tecnologias e versões declaradas nos `package.json`', ['Camada', 'Tecnologia', 'Uso'], [
    ['Linguagem e runtime', 'Node 24, TypeScript 7 (`tsx` executa direto)', 'API, MCP e contratos; o front usa JavaScript (JSX)'],
    ['API', 'Express 5, Socket.io 4, `pg` 8, zod 4', 'REST, tempo real, acesso ao banco e validação'],
    ['Segurança', '`jsonwebtoken`, `scrypt` (módulo `crypto`), `cors`, limites de taxa próprios', 'Autenticação, hash de senha, CORS e proteção contra abuso'],
    ['Outros da API', '`web-push`, `compression`, `swagger-ui-express`, `yaml`, `@anthropic-ai/sdk`', 'Push, gzip, documentação OpenAPI e leitura de ofertas por IA'],
    ['Banco', 'PostgreSQL com `citext`, `pg_trgm`, `unaccent`, `cube` e `earthdistance`', 'E-mail sem caixa, busca por similaridade e sem acento, distância geográfica; fuso America/Fortaleza'],
    ['Front', 'React 19, Vite 8, react-router 7, Leaflet, Recharts, socket.io-client, Firebase (opcional)', 'Vitrine, painel, mapas, gráficos, tempo real e login Google'],
    ['PWA', 'Service worker próprio (`sw.js`) e `manifest.webmanifest`', 'Instalação, cache do shell e push'],
    ['IA', 'API do Claude (modelo configurável em `DEALS_MODEL`) e `@modelcontextprotocol/sdk`', 'Extração de ofertas e ferramentas do comerciante'],
    ['Testes', '`node:test` via `tsx`, `embedded-postgres`, `socket.io-client`', 'Testes de integração com Postgres real, sem Docker'],
    ['Implantação', 'Render (blueprint), Vercel ou Cloudflare Pages, PM2', 'Alternativas sem container (cap. 11)'],
  ], { w: [0.2, 0.42, 0.38], size: 'sm' }),
  p('O `db/schema.sql` declara PostgreSQL 16 no cabeçalho, enquanto o Postgres embutido de desenvolvimento usa a série 18 (beta). A versão que será usada em produção não está definida no repositório; o Render usa a versão do plano contratado.'),
]
