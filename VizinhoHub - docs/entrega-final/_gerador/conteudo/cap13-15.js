'use strict'
const { h1, h2, h3, p, ul, ol, table, box, code } = require('../modelo')
const F = require('./fatos')

const REPO = 'projetos/VizinhoHub'
const DOCS = 'projetos/VizinhoHub/VizinhoHub - docs'

module.exports = () => [
  // ------------------------------------------------------------------ 13
  h1('Autoavaliação de competências'),
  box('Rascunho para revisão do autor', ['Este capítulo é um rascunho em primeira pessoa, redigido a partir das evidências do repositório. Percepções, motivações e aprendizados pessoais devem ser revistos e ajustados pelo autor antes da entrega.'], { kind: 'todo' }),
  p('Esta autoavaliação é escrita em primeira pessoa e se apoia em evidências do próprio repositório. Sempre que a evidência é só minha percepção, digo isso.'),
  h2('Cognição'),
  p('Aprendi a tratar a concorrência como problema de projeto, e não de correção posterior. O ponto de virada foi perceber que "ler o saldo e depois gravar" nunca é seguro quando duas pessoas compram a última unidade ao mesmo tempo, e que a solução é deixar o banco decidir com uma instrução condicional. Apliquei o mesmo padrão em seis casos (oferta relâmpago, limite por cliente, fiado, vaga de encomenda, prato do dia e aceite de corrida) e o medi com testes de 6 a 30 transações simultâneas. Também consolidei modelagem de dados (restrições no banco, índices parciais), arquitetura em camadas, tempo real com Socket.io e segurança básica (hash de senha, papel lido do banco, retenção de dados).'),
  p('Um erro de entendimento que corrigi tarde: modelei por um tempo estoque de produto e uma rede de troca entre mercadinhos, e só em 20 e 21/11/2026 concluí que o VizinhoHub é um intermediário de descontos, sem mercadoria própria. Retirei esse código em vez de mantê-lo (commit 13.1), mas a limpeza do schema ficou incompleta (capítulos 6 e 12). Aprendi que decisões de escopo precisam ser testadas com o problema real antes de virar código.'),
  h2('Colaboração'),
  p('O trabalho foi individual: o repositório tem um único autor, e eu fui, ao mesmo tempo, desenvolvedor, analista e testador. Isso limitou a revisão por pares; compensei com testes de integração, documentação conferida contra o código e commits pequenos, um por ideia, com mensagem padronizada. Não tenho evidência registrada de co-criação com a comunidade atendida. A interação com o docente e com possíveis usuários é algo que preciso confirmar e documentar (ver "Pontos a confirmar", capítulo 14). Reconheço que um projeto de extensão pede mais escuta do território do que consegui registrar.'),
  h2('Comunicação'),
  p('Procurei escrever para dois públicos: o comerciante, com telas de vocabulário simples, mensagens de erro em português e ofertas criadas por conversa (servidor MCP); e o leitor técnico, com documentação, OpenAPI gerado do código e diagramas versionados. Este relatório é parte desse esforço: ele separa o que foi medido do que é expectativa e lista o que ainda não foi comprovado. Um ponto fraco é a comunicação com usuários reais, que ainda não ocorreu: as personas são arquétipos que construí, não resultados de entrevista.'),
  h2('Cidadania'),
  p('A escolha do problema (pequeno varejo de bairro, desperdício de alimentos, acesso a preço melhor) partiu de uma preocupação com a economia local e com o consumo responsável, e se relaciona aos ODS 8, 9, 11 e 12 (capítulo 2). No projeto, isso aparece em decisões concretas: sem comissão sobre as vendas do comerciante, sem custódia do dinheiro de terceiros, respeito ao `robots.txt` das redes, retenção limitada de dados pessoais e GPS apagado em 30 dias. Meu limite é que o impacto social **não foi medido**: não houve piloto com lojas reais, e não afirmo benefício a ninguém além do que o código permite.'),
  h2('Aprendizados e pontos de melhoria'),
  ul([
    'Validar com usuários reais antes de ampliar o escopo; o piloto é o próximo passo.',
    'Registrar decisões de arquitetura (ADR) no momento em que são tomadas, e não reconstruí-las depois, como foi preciso neste relatório.',
    'Manter a documentação sincronizada com o código: parte dos documentos 01 a 08 ficou desatualizada (Apêndice E).',
    'Cobrir o front com testes automatizados e executar o build na integração contínua.',
  ]),

  // ------------------------------------------------------------------ 14
  h1('Conclusão'),
  p(`O VizinhoHub nasceu para dar ao pequeno varejo do bairro uma vitrine, um painel de pedidos em tempo real e um jeito simples de aparecer com descontos, sem comissão sobre as vendas do comerciante. Em dois meses (${F.commits} commits entre 29/09 e 23/11/2026), o projeto entregou uma plataforma funcional: ${F.operacoes} operações de API, ${F.tabelas} tabelas, ${F.telas} telas, um servidor MCP com ${F.ferramentasMcp} ferramentas e ${F.testesApi + F.testesMcp + F.testesContratos} testes automatizados aprovados.`),
  p('Os objetivos técnicos foram cumpridos: pedidos chegam ao painel por WebSocket sem recarregar a tela; as vendas de quantidade limitada resistem à concorrência (30 clientes disputando 5 unidades vendem exatamente 5); as ofertas dos supermercados são lidas por IA e validadas pelo servidor; o cupom de retirada registra a economia do cliente; e a logística, a caderneta, o Clube VIP e o carrinho inteligente têm API, regras e testes.'),
  p('Os objetivos de impacto, por sua vez, **não puderam ser comprovados**. O repositório não registra implantação pública, uso por comerciantes reais, entrevistas nem resultados de feedback. O trabalho entrega, portanto, uma base técnica sólida e documentada, pronta para um piloto, mas ainda não demonstra os efeitos para a comunidade. A decisão de 20/11/2026 (o VizinhoHub é um intermediário de descontos, sem estoque próprio) definiu com clareza o que o produto é e o que não é, e vale como a principal lição de escopo do projeto.'),
  box('Pontos a confirmar pelo autor (resumo final)', [
    '**Número de beneficiários:** estimativa de 32 pessoas (2 comerciantes e cerca de 30 moradores de teste) não verificável no repositório.',
    '**Entrevistas, oficinas e feedback:** sem registro; personas e histórias são arquétipos.',
    '**Validação com comerciantes reais e implantação pública:** nenhuma URL de produção no repositório; escolha entre Vercel e Cloudflare Pages em aberto; planos do Render a conferir.',
    '**Fontes:** faixa de comissão de marketplaces (12% a 25%) sem fonte primária; numeração dos artigos da Resolução CNE/CES nº 7/2018 e referências deste relatório a conferir nos textos oficiais.',
    '**ADRs:** reconstruídos a partir do documento 10 e da decisão de 20/11/2026; confirmar contexto e consequências.',
    '**Identificadores de requisito (RF, RNF, RN, US):** criados neste relatório; a documentação anterior não os tinha.',
    '**Build do front:** não executado nesta verificação (os testes de API, MCP e contratos foram).',
    '**Colaboração e orientação:** interação com docente e com a comunidade não está registrada; completar a seção de Colaboração.',
    '**Versão do PostgreSQL em produção:** o cabeçalho do schema cita a 16, o Postgres embutido de desenvolvimento usa a série 18.',
    '**Modelo de repasse das redes:** o lucro do cupom pressupõe acordo com a rede; não há acordo registrado.',
  ], { kind: 'todo' }),

  // ------------------------------------------------------------------ 15
  h1('Referências'),
  box('Sobre as referências', [
    'As referências abaixo foram citadas de memória pelo autor deste relatório, sem acesso à internet na geração. Autor, título e ano devem ser conferidos nos textos oficiais antes da entrega.',
  ], { kind: 'warn' }),
  h2('Normas e documentos oficiais'),
  ul([
    'BRASIL. Ministério da Educação. Conselho Nacional de Educação. Câmara de Educação Superior. **Resolução CNE/CES nº 7, de 18 de dezembro de 2018.** Estabelece as Diretrizes para a Extensão na Educação Superior Brasileira.',
    'BRASIL. **Lei nº 13.709, de 14 de agosto de 2018.** Lei Geral de Proteção de Dados Pessoais (LGPD).',
    'ORGANIZAÇÃO DAS NAÇÕES UNIDAS. **Transformando Nosso Mundo: a Agenda 2030 para o Desenvolvimento Sustentável.** 2015 (ODS 8, 9, 11 e 12).',
    'IETF. **RFC 7519: JSON Web Token (JWT).** 2015.',
    'IETF. **RFC 6455: The WebSocket Protocol.** 2011.',
  ]),
  h2('Livros e artigos técnicos'),
  ul([
    'SOMMERVILLE, I. **Engenharia de Software.** 10. ed. São Paulo: Pearson, 2018.',
    'BROWN, S. **The C4 model for visualising software architecture.** (modelo C4 de diagramas de arquitetura).',
    'OWASP FOUNDATION. **OWASP Top 10.** (riscos de segurança em aplicações web).',
    'CLEGG, D.; BARKER, R. **Case Method Fast-Track: A RAD Approach.** Addison-Wesley, 1994. (origem do método de priorização MoSCoW, do DSDM).',
  ]),
  h2('Documentação das tecnologias'),
  ul([
    'POSTGRESQL GLOBAL DEVELOPMENT GROUP. **PostgreSQL Documentation:** controle de concorrência, `INSERT … ON CONFLICT`, `LISTEN/NOTIFY`, índices parciais e extensões `pg_trgm`, `citext`, `unaccent` e `earthdistance`.',
    'SOCKET.IO. **Documentation** (salas, namespaces e autenticação no handshake).',
    'MODEL CONTEXT PROTOCOL. **Specification** e SDK TypeScript (`@modelcontextprotocol/sdk`).',
    'React, Vite, Express, zod, Leaflet, Recharts e OSRM: documentação oficial de cada projeto.',
  ]),

  // ------------------------------------------------------------------ Apêndices
  h1('Apêndice A — Glossário', { num: 'A', noNum: true }),
  table('Glossário', ['Termo', 'Significado neste projeto'], [
    ['ADR', 'Registro de decisão arquitetural (contexto, decisão, consequências)'],
    ['Adapter', 'Camada que isola um serviço externo (pagamento, rotas, leitura de ofertas) atrás de uma interface substituível'],
    ['Caderneta', 'O fiado da loja: conta do cliente com limite e livro-razão só de inserção'],
    ['Cupom de retirada', 'Reserva de preço de uma oferta de supermercado, com código válido por 24 h; vira venda quando o cliente confirma a compra'],
    ['Core API', 'A API REST e Socket.io em `apps/api`'],
    ['DER', 'Diagrama entidade-relacionamento'],
    ['DFD', 'Diagrama de fluxo de dados'],
    ['Encarte', 'Folheto de ofertas de uma rede, em imagem ou PDF'],
    ['Extensão universitária', 'Atividade que aplica o conhecimento acadêmico para atender a comunidade (Resolução CNE/CES nº 7/2018)'],
    ['Fiado', 'Compra a prazo, paga depois'],
    ['Frota própria', 'Entrega feita pelos funcionários da loja, conduzida pelo painel'],
    ['Intermediário de descontos', 'Papel do VizinhoHub: leva ofertas das redes ao morador, sem estoque nem mercadoria própria'],
    ['JWT', 'Token assinado de autenticação (HS256, 7 dias)'],
    ['Kanban', 'Quadro de colunas por estado do pedido (novos, em preparação, prontos)'],
    ['LGPD', 'Lei Geral de Proteção de Dados Pessoais'],
    ['LISTEN/NOTIFY', 'Mecanismo do PostgreSQL usado para avisar a API de que o catálogo mudou'],
    ['Livro-razão (ledger)', 'Registro só de inserção que explica cada alteração de saldo'],
    ['Manager', 'Painel do comerciante'],
    ['MCP', 'Model Context Protocol: padrão para que assistentes de IA chamem ferramentas'],
    ['MoSCoW', 'Priorização: Must, Should, Could, Won\'t (agora)'],
    ['OSRM', 'Serviço de rotas sobre dados do OpenStreetMap'],
    ['PDV', 'Ponto de venda (venda de balcão)'],
    ['PIN', 'Código de 4 dígitos que o cliente informa ao entregador para confirmar a entrega'],
    ['Pool de entregadores', 'Entregadores autônomos do bairro que recebem convites de corrida'],
    ['Prato do dia', 'Item com porções limitadas por dia, vendido enquanto houver saldo'],
    ['PWA', 'Aplicativo web instalável, com cache e push'],
    ['Radar', 'Tela que lista ofertas relâmpago por perto'],
    ['RBAC', 'Controle de acesso por papel (cliente, comerciante)'],
    ['Relâmpago (Tá Quentinho)', 'Oferta de quantidade limitada, prazo e raio definidos pelo comerciante'],
    ['Salva-Estoque', 'Desconto automático por validade (50% se vence em até 1 dia, 30% em até 3)'],
    ['Selo Vizinho VIP', 'Assinatura mensal que dá desconto e frete grátis nas lojas aderentes'],
    ['Store', 'Vitrine pública do cliente'],
    ['`UPDATE` condicional', 'Instrução que altera a linha só se a regra ainda vale; é o lock dos casos de concorrência'],
    ['zod', 'Biblioteca de validação de dados usada na API, no front e no MCP'],
  ], { w: [0.26, 0.74], size: 'sm' }),

  h1('Apêndice B — Índice dos documentos do projeto', { num: 'B', noNum: true }),
  p(`Caminhos relativos à pasta \`${REPO}\`, no computador do autor. A pasta de documentação é \`VizinhoHub - docs\`.`),
  table('Documentos do projeto', ['Documento', 'Caminho', 'Observação'], [
    ['README do repositório', '`README.md`', 'Visão, stack, estrutura e mapa de telas'],
    ['README da documentação', '`VizinhoHub - docs/README.md`', 'Índice da pasta de documentos'],
    ['01 Visão geral', '`VizinhoHub - docs/01-visao-geral.md`', 'Parcialmente desatualizado (Apêndice E)'],
    ['02 Fluxo do usuário', '`VizinhoHub - docs/02-fluxo-do-usuario.md`', 'Fluxos de cliente e comerciante'],
    ['03 Wireframes', '`VizinhoHub - docs/03-wireframes.md`', 'Desatualizado (descreve Departamentos e protótipo)'],
    ['04 Arquitetura e stack', '`VizinhoHub - docs/04-arquitetura-e-stack.md`', 'Desatualizado (cita Next.js, Prisma, NestJS)'],
    ['05 Modelagem de dados', '`VizinhoHub - docs/05-modelagem-de-dados.md`', 'DER mínimo; este relatório o substitui'],
    ['06 Contrato da API', '`VizinhoHub - docs/06-contrato-api.md`', 'Desatualizado; o OpenAPI é a referência'],
    ['07 Estrutura do repositório', '`VizinhoHub - docs/07-estrutura-do-repositorio.md`', 'Estrutura de pastas'],
    ['08 Protótipo HTML e CSS', '`VizinhoHub - docs/08-prototipo-html-css.md`', 'Protótipo removido do repositório (commit 12.x)'],
    ['09 Ofertas do bairro', '`VizinhoHub - docs/09-ofertas-do-bairro.md`', 'Fluxo, regras e limitações (parte desatualizada)'],
    ['10 Roadmap dos módulos avançados', '`VizinhoHub - docs/10-roadmap-modulos-avancados.md`', 'Schema novo, anti-race, decisões de 16/11'],
    ['Especificação OpenAPI', '`VizinhoHub - docs/openapi.yaml`', `${F.operacoes} operações; gerada do código (\`npm run openapi\`)`],
    ['Diagrama de arquitetura (SVG)', '`VizinhoHub - docs/arquitetura.svg`', 'Versão anterior'],
    ['Diagrama ER (SVG)', '`VizinhoHub - docs/der.svg`', 'Versão anterior'],
    ['Documento técnico (Word)', '`VizinhoHub - docs/VizinhoHub-Documento-Tecnico.docx`', 'Documento técnico do projeto'],
    ['Slides da etapa 1', '`VizinhoHub - docs/VizinhoHub-Etapa1.pptx`', 'Apresentação da primeira etapa'],
    ['Slides das etapas 4 e 5', '`VizinhoHub - docs/VizinhoHub-Etapas4e5.pptx`', 'Apresentação das etapas 4 e 5'],
    ['Servidor MCP (README)', '`apps/mcp-server/README.md`', 'Ferramentas e configuração'],
    ['Modelo de variáveis', '`.env.example`, `.env.prod.example`, `apps/web/.env.example`', 'Sem segredos'],
    ['Blueprint de implantação', '`render.yaml`, `ecosystem.config.cjs`, `apps/web/vercel.json`', 'Itens "CONFERIR" no blueprint'],
    ['Relatório final (este documento)', '`VizinhoHub - docs/entrega-final/Relatorio-Final-VizinhoHub.docx` e `.pdf`', 'Gerado por `entrega-final/_gerador`'],
    ['Slides finais', '`VizinhoHub - docs/entrega-final/Slides-VizinhoHub-Final.pptx`', 'Apresentação final (gerador em `_gerador-slides`)'],
    ['Diagramas (Mermaid, PNG, SVG)', '`VizinhoHub - docs/entrega-final/diagramas/` (README com o catálogo)', '23 diagramas, com fonte `.mmd`'],
    ['Capturas de tela', '`VizinhoHub - docs/entrega-final/capturas/` (README com a lista)', '23 capturas, com dados de demonstração'],
  ], { w: [0.26, 0.48, 0.26], size: 'xs' }),

  h1('Apêndice C — Catálogo de diagramas', { num: 'C', noNum: true }),
  table('Catálogo de diagramas (`entrega-final/diagramas`)', ['Nº', 'Nome', 'Tipo', 'Onde aparece'], [
    ['01', 'Casos de uso', 'UML', 'Cap. 5'],
    ['02', 'Classes de domínio', 'UML', 'Cap. 6'],
    ['03', 'DER do núcleo', 'Entidade-relacionamento', 'Cap. 6'],
    ['04', 'DER dos módulos avançados (compacto)', 'Entidade-relacionamento', 'Só em arquivo (visão geral)'],
    ['04a', 'DER: logística, caderneta e agenda', 'Entidade-relacionamento', 'Cap. 6'],
    ['04b', 'DER: VIP, carrinho e combos', 'Entidade-relacionamento', 'Cap. 6'],
    ['05', 'Contexto', 'C4 nível 1', 'Cap. 7'],
    ['06', 'Containers', 'C4 nível 2', 'Cap. 7'],
    ['07', 'Camadas do back-end', 'Arquitetura', 'Cap. 7'],
    ['08', 'Pedido em tempo real', 'Sequência', 'Cap. 6'],
    ['09', 'Disputa pela última unidade', 'Sequência', 'Cap. 6'],
    ['10', 'Cupom das ofertas do bairro', 'Sequência', 'Cap. 6'],
    ['11', 'Estados do pedido', 'Máquina de estados', 'Cap. 6'],
    ['12', 'Estados do cupom', 'Máquina de estados', 'Cap. 6'],
    ['13', 'Atividades do cliente', 'Atividades', 'Cap. 6'],
    ['14', 'Atividades do comerciante', 'Atividades', 'Cap. 6'],
    ['15', 'DFD nível 0', 'Fluxo de dados', 'Cap. 6'],
    ['15b', 'DFD nível 1', 'Fluxo de dados', 'Cap. 6'],
    ['16', 'Implantação', 'UML', 'Cap. 11'],
    ['17', 'Mapa de telas', 'Mapa mental', 'Cap. 9'],
    ['18', 'Cronograma', 'Gantt', 'Cap. 3'],
    ['19', 'Requisitos', 'Mapa mental', 'Cap. 4'],
    ['20', 'Segurança e LGPD', 'Fluxo', 'Cap. 10'],
  ], { w: [0.08, 0.4, 0.28, 0.24], size: 'sm' }),
  p('Os diagramas verticais (01, 13, 14 e 15b) aparecem divididos em partes neste relatório; os arquivos originais, completos, estão na pasta. Para editar, altere o `.mmd` e gere de novo com `mmdc -i arquivo.mmd -o arquivo.png -s 2`.'),

  h1('Apêndice D — Estrutura do repositório', { num: 'D', noNum: true }),
  code(`VizinhoHub/
├── apps/
│   ├── api/                  Core API (Node 24, TypeScript, Express 5)
│   │   ├── src/
│   │   │   ├── app.ts, server.ts
│   │   │   ├── shared/       auth, db, env, errors, firebase, jobs,
│   │   │   │                 password, rate-limit, realtime
│   │   │   ├── docs/         geração do OpenAPI
│   │   │   └── modules/      20 módulos (schema, repository, service,
│   │   │                     routes): addresses, analytics, auth,
│   │   │                     branches, catalog-live, categories, credit,
│   │   │                     daily-menu, deals, delivery, flash, ops,
│   │   │                     orders, pos, products, reports, scheduling,
│   │   │                     smart-cart, stores, vip
│   │   ├── scripts/          db-setup, migrate, create-merchant,
│   │   │                     import-catalog, import-branches,
│   │   │                     link-canonicals, scan-deals,
│   │   │                     seed-demo-sales, dev-db, dev-token,
│   │   │                     export-openapi
│   │   └── test/             22 arquivos de teste de integração
│   ├── web/                  React 19 + Vite 8 (PWA)
│   │   ├── src/pages/        Login, NotFound, store/, courier/, admin/
│   │   ├── src/components/   cartões, mapas, diálogos, barras
│   │   ├── src/context/      Auth, Cart, Catalog, Admin
│   │   ├── src/lib/          api, realtime, alert, push, flash...
│   │   └── public/           sw.js, manifest.webmanifest, img/,
│   │                         _headers, _redirects
│   └── mcp-server/           Servidor MCP do lojista (10 ferramentas)
├── packages/
│   └── contracts/            schemas zod, DTOs e eventos de tempo real
├── db/
│   ├── schema.sql            esquema consolidado (${F.tabelas} tabelas)
│   ├── migrations/           ${F.migracoes} migrações (001 a 019, sem 011)
│   ├── catalog/              products, curated, ampliacao (JSON)
│   └── seed.sql              dados de DESENVOLVIMENTO (nunca em produção)
├── VizinhoHub - docs/        documentação (01 a 10, openapi.yaml)
│                             e entrega-final/
├── render.yaml               blueprint do Render (API + Postgres)
├── ecosystem.config.cjs      PM2 para VPS
└── .env.example, .env.prod.example`),

  h1('Apêndice E — Divergências entre a documentação anterior e o código', { num: 'E', noNum: true }),
  p('Durante a elaboração deste relatório, cada afirmação foi conferida no código. Onde a documentação anterior discorda, **prevalece o código**. A tabela lista o que foi encontrado, sem alterar nenhum arquivo do projeto.'),
  table('Divergências encontradas', ['Onde', 'O que diz', 'O que o código mostra'], [
    ['Docs 01, 03 e 08', 'Descrevem um protótipo HTML e CSS e os Departamentos como parte do produto', 'O protótipo foi removido (commit 12.x) e o front real é React + Vite; o painel não tem Departamentos nem Encartes'],
    ['Doc 04', 'Cita Next.js, Tailwind, Prisma, NestJS e FastAPI como plano', 'React + Vite, Express 5, SQL puro com `pg`; Next.js adiado (decisão de 16/11/2026); sem Prisma'],
    ['Doc 05', 'DER mínimo e papel "ADMIN"', 'Papéis `MERCHANT` e `CUSTOMER`; 43 tabelas; sem papel `ADMIN`; entregador é perfil'],
    ['Doc 06', 'Contrato da API de uma fase inicial', `${F.operacoes} operações no OpenAPI gerado do código`],
    ['Doc 09', 'Front usa bairro fixo "Aldeota"; pedido de entrega não existe; upload sem tela', 'O endereço é escolhido pelo usuário; o módulo de logística existe; o upload segue sem tela'],
    ['Doc 10', 'Árvore de `apps/web` como referência de uma futura migração a Next.js', 'Referência de futuro; o front atual é `apps/web` em React + Vite'],
    ['`db/schema.sql`', 'Cabeçalho cita "container" e `docker-compose.yml`; PostgreSQL 16', 'Não há Docker no projeto; o Postgres embutido de desenvolvimento é da série 18'],
    ['`db/schema.sql`', 'Ainda contém `allow_b2b_sharing`, `b2b_reserve_qty`, `idx_products_b2b`, `v_b2b_surplus`, `stock_qty` (padrão 0) e `stock_movements`', 'O estoque e a Rede B2B foram removidos do código; restam vestígios por compatibilidade (migração 019)'],
    ['`db/seed.sql`', 'Ainda referencia a Rede B2B', 'Dados de desenvolvimento desatualizados em relação à decisão de 20/11'],
    ['`manifest.webmanifest`', 'Descrição fala em "gestão de estoque"', 'O produto não gerencia estoque'],
    ['`packages/contracts` (`realtime.ts`)', 'Comentários marcam `delivery:offered` e `delivery:location` como "previsto (roadmap)"', 'A API já emite os dois eventos'],
    ['Migrações', 'Numeração de 001 a 019', 'Existem 18 arquivos; não há a migração 011'],
    ['Todos os documentos', 'Sem identificadores de requisito (RF, RNF, RN) nem arquivos de ADR', 'Identificadores e ADRs criados neste relatório (reconstruções)'],
    ['PDV, abrir loja, envio de encarte', 'Documentados como funcionalidades', 'Têm API, mas não têm tela no painel'],
    ['nginx', 'Citado no README como proxy reverso', 'Apenas exemplo; não há arquivo de configuração no repositório'],
  ], { w: [0.2, 0.38, 0.42], size: 'xs', key: 'diverg' }),
]
