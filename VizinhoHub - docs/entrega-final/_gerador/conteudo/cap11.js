'use strict'
const { h1, h2, h3, p, ul, table, fig, box, code } = require('../modelo')

module.exports = () => [
  h1('Implantação e operação'),
  box('Estado real da implantação', [
    '**Sem implantação pública confirmada.** O repositório não registra nenhuma URL de produção, e este relatório não afirma que o sistema esteja no ar. O que existe são os artefatos para implantar (blueprint do Render, configuração do Vercel, arquivo do PM2) e o ambiente de desenvolvimento local, no qual todas as capturas e testes foram feitos.',
    'O Render Blueprint traz planos marcados "CONFERIR" no próprio arquivo: nomes de planos e a versão de Node suportada precisam ser conferidos antes do primeiro deploy.',
  ], { kind: 'warn' }),

  h2('Topologia de implantação'),
  fig('16-implantacao', 'Implantação: Render e Vercel/Cloudflare Pages, alternativa com PM2 em VPS e serviços externos.'),
  p('A topologia de referência separa o **front estático** (Vercel ou Cloudflare Pages) da **API com PostgreSQL gerenciado** (Render). A escolha entre Vercel e Cloudflare Pages para o front **continua em aberto**: o repositório traz o `vercel.json`, mas nenhuma decisão registrada. Como alternativa, a API pode rodar em uma VPS com PM2 (`ecosystem.config.cjs`); nesse caso, um proxy reverso é necessário para HTTPS e WebSocket. O README cita o nginx apenas como **exemplo** de proxy; não há arquivo de configuração dele no repositório.'),
  table('Opções de implantação previstas', ['Componente', 'Opção A (Render + front estático)', 'Opção B (VPS sem container)'], [
    ['Front', 'Vercel (há `vercel.json` com rewrites para o SPA e cache longo para `/assets`) ou Cloudflare Pages (`_headers` e `_redirects` em `public/`)', 'Arquivos estáticos servidos por proxy reverso'],
    ['API', 'Web service Node nativo no Render, `healthCheckPath: /health`', 'PM2 executando `src/server.ts` com `tsx`, reinício automático e `kill_timeout` de 10 s'],
    ['Banco', 'PostgreSQL gerenciado do Render (`vizinhohub-db`)', 'PostgreSQL próprio ou gerenciado'],
    ['Migração', '`preDeployCommand: npm run db:setup` a cada deploy', '`npm run db:setup` manual antes de subir'],
    ['Variáveis', 'Painel do Render (`sync: false` para os segredos)', 'Arquivo `.env.prod` fora do git (modelo em `.env.prod.example`)'],
    ['HTTPS e WebSocket', 'Fornecidos pela plataforma', 'Proxy reverso (exemplo: nginx)'],
  ], { w: [0.14, 0.46, 0.4], size: 'sm' }),

  h2('Variáveis de ambiente'),
  table('Variáveis de ambiente da API', ['Variável', 'Obrigatória', 'Para que serve'], [
    ['`DATABASE_URL`', 'Sim', 'Conexão com o PostgreSQL'],
    ['`JWT_SECRET`', 'Sim (32+ caracteres em produção)', 'Assinatura dos tokens; o Render pode gerar o valor'],
    ['`NODE_ENV`', 'Sim em produção', '`production` ativa as proteções (CORS sem `localhost`, recusa de contas de desenvolvimento)'],
    ['`API_PORT`', 'Não', 'Porta da API (padrão de desenvolvimento 3333)'],
    ['`CORS_ORIGIN`', 'Sim em produção', 'Origens permitidas, separadas por vírgula (domínio do front)'],
    ['`TZ`', 'Recomendada', '`America/Fortaleza`'],
    ['`API_DOCS`', 'Não', 'Liga ou desliga o Swagger e o OpenAPI (`true` por padrão)'],
    ['`FIREBASE_PROJECT_ID`', 'Não', 'Projeto cujos ID tokens a API aceita; sem ele o login Google responde 501'],
    ['`ANTHROPIC_API_KEY`', 'Não', 'Liga o job de leitura de ofertas e o envio de encarte (sem ela, 501)'],
    ['`DEALS_MODEL`, `DEALS_SCAN_INTERVAL_MIN`, `DEALS_USER_AGENT`', 'Não', 'Modelo, intervalo (padrão 60 min) e identificação do robô'],
    ['`OSRM_URL`, `BRANCH_AT_RADIUS_M`', 'Não', 'Serviço de rotas (padrão: OSRM público) e raio de "já estou na loja" (50 m)'],
    ['`VIP_PROVIDER`, `VIP_MOCK_WEBHOOK_SECRET`', 'Não', '`mock` (padrão) ou `asaas`; segredo do webhook de simulação'],
    ['`ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`', 'Só com `asaas`', 'Credenciais do provedor (usar o Sandbox)'],
    ['`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`', 'Não', 'Chaves do Web Push'],
  ], { w: [0.34, 0.2, 0.46], size: 'sm', key: 'env' }),
  p('O front tem as suas: `VITE_API_URL` (base da API), as chaves do Firebase (`VITE_FIREBASE_*`) e, opcionalmente, `VITE_GOOGLE_MAPS_API_KEY` (sem ela, a busca de endereços usa o OpenStreetMap). Por serem lidas no build, qualquer chave `VITE_*` fica visível no navegador e não pode ser segredo.'),

  h2('Scripts de operação'),
  table('Scripts de `apps/api` (`npm run <nome>`)', ['Script', 'O que faz', 'Quando usar'], [
    ['`dev:db`', 'Sobe um PostgreSQL embutido na URL do `.env`, sem Docker', 'Desenvolvimento local'],
    ['`db:setup`', 'Aplica `schema.sql` se o banco estiver vazio, roda as migrações idempotentes e fixa o fuso do banco. Nunca carrega o seed', 'A cada deploy (`preDeployCommand`) e na criação do banco'],
    ['`migrate`', 'Aplica as migrações de `db/migrations`', 'Atualizar um banco existente'],
    ['`create-merchant`', 'Cria ou promove um comerciante (`--email`, `--name`, `--store`, `--neighborhood`, `--city`, `--lat`, `--lng`, `--password`). O cadastro público só gera clientes', 'Abrir a loja de um comerciante (a API ainda não tem tela para isso)'],
    ['`import-catalog`', 'Importa o catálogo de `db/catalog` (437 produtos e a ampliação de 1.888, em 24 departamentos) como produtos de um comerciante; idempotente (`--merchant`, `--demo-offers`, `--sem-ampliacao`)', 'Popular a vitrine'],
    ['`link-canonicals`', 'Liga produtos aos itens canônicos (por heurística de nome)', 'Alimentar o Carrinho Inteligente'],
    ['`import-branches`', 'Importa filiais de Fortaleza do OpenStreetMap, sem duplicar e sem apagar as manuais', 'Ofertas do bairro com filial mais próxima'],
    ['`scan-deals`', 'Executa a varredura de ofertas uma vez', 'Teste manual ou execução sob demanda'],
    ['`seed-demo-sales`', 'Gera cerca de 30 dias de vendas de demonstração', 'Só em desenvolvimento, para o painel de Análises'],
    ['`dev-token`', 'Gera um token de desenvolvimento', 'Testar a API à mão'],
    ['`openapi`', 'Exporta o `openapi.yaml` a partir do código', 'Atualizar a documentação'],
    ['`typecheck`, `test`', '`tsc --noEmit` e a suíte de testes de integração', 'Antes de cada entrega'],
    ['`start`, `start:prod`', 'Inicia a API (`tsx`), com ou sem arquivo `.env`', 'Execução'],
  ], { w: [0.17, 0.5, 0.33], size: 'xs' }),
  p('O arquivo `db/seed.sql` cria contas de **desenvolvimento** (`@vizinhohub.test`, entre elas a loja de exemplo e a cliente de exemplo) e **nunca** deve ser aplicado em produção; a API recusa iniciar se encontrá-las.'),

  h2('Operação diária e monitoramento'),
  ul([
    '**Saúde:** `GET /health` verifica a API e o banco; é usado como `healthCheckPath` no Render.',
    '**Jobs na própria API:** recálculo do Salva-Estoque (ao subir, de hora em hora e a cada cadastro), encerramento de ofertas relâmpago (a cada minuto), varredura das ofertas das redes (a cada hora, com trava no banco), limpeza de GPS (diária), funil e pedidos antigos, renovações do Clube VIP e lembretes da caderneta.',
    '**Logs:** texto no stdout; no PM2, gravados em `logs/api.out.log` e `logs/api.err.log`. Não há logs estruturados, métricas, tracing nem alertas.',
    '**Estado das fontes de ofertas:** `deal_sources.last_status` e `last_error` mostram qual página falhou.',
    '**Encerramento:** a API fecha conexões e o pool ao receber SIGTERM.',
  ]),
  p('Não há plano de backup do banco, de recuperação de desastres nem de monitoramento de disponibilidade no repositório. Em hospedagem gerenciada, o backup depende do plano contratado.'),
]
