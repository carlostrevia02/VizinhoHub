# 🛒 VizinhoHub — Hub do Pequeno Varejo Comunitário

> Plataforma web de vitrine virtual e gestão de estoque em tempo real para micro-comércios de bairro.

## 📌 Sobre o Projeto
O **VizinhoHub** é um projeto de extensão universitária desenvolvido para a disciplina de Desenvolvimento de Plataformas Web do Centro de Ciências Tecnológicas da **Universidade de Fortaleza (Unifor)**.

A plataforma busca digitalizar o pequeno varejo comunitário de Fortaleza, conectando comerciantes locais aos moradores do bairro de forma direta, sem cobrança de taxas abusivas de intermediação.

## 🎯 Desafios Técnicos de Engenharia
- **Notificações em Tempo Real:** comunicação via **WebSockets** para atualização instantânea do painel de pedidos do comerciante.
- **Integridade Transacional de Estoque:** prevenção de *race conditions* na venda simultânea de itens escassos.
- **Arquitetura Limpa:** organização desacoplada do backend (*Clean Architecture / Layered Architecture*).

## 🛠️ Tech Stack Planejada
- **Frontend:** HTML, CSS e JavaScript → migrado para **React + Vite + React Router + Firebase Auth**
- **Backend:** Node.js (NestJS / Express) ou Python (FastAPI)
- **Banco de Dados:** PostgreSQL + Prisma ORM / Drizzle ORM
- **Infraestrutura:** Render (API + Postgres) · Vercel/Cloudflare Pages (front) · alternativa PM2 em VPS

## 📚 Documentação
- [01 — Visão Geral](VizinhoHub%20-%20docs/01-visao-geral.md)
- [02 — Fluxo do Usuário](VizinhoHub%20-%20docs/02-fluxo-do-usuario.md)
- [03 — Wireframes](VizinhoHub%20-%20docs/03-wireframes.md)
- [04 — Arquitetura e Stack](VizinhoHub%20-%20docs/04-arquitetura-e-stack.md)
- [09 — Ofertas do Bairro](VizinhoHub%20-%20docs/09-ofertas-do-bairro.md) — descontos dos supermercados da vizinhança + cupom de retirada
- [Servidor MCP do lojista](apps/mcp-server/README.md) — gerencie ofertas (relâmpago, prato do dia, combo) conversando com a IA
- Slides: `VizinhoHub-Etapa1.pptx`

## 🚀 Setup local (Etapa 2)
```bash
cp .env.example .env
cd apps/api && npm install && npm run dev:db   # Postgres local (embutido) em localhost:5432 com schema + seed; deixe rodando
# em outro terminal:
cd apps/api && npm run import-catalog && npm run dev   # API em http://localhost:3333/api/v1
```
Dados de exemplo para o painel de Análises (só dev; idempotente): `cd apps/api && npm run seed-demo-sales` cria ~30 dias de pedidos, cupons confirmados e visitas da vitrine para o Zé (`-- --clean` remove).
Teste manual da API: coleção do **Thunder Client** em [`apps/api/thunder`](apps/api/thunder/README.md).
- Modelagem: [VizinhoHub - docs/05-modelagem-de-dados.md](VizinhoHub%20-%20docs/05-modelagem-de-dados.md) · [DER](VizinhoHub%20-%20docs/der.svg)
- Contrato da API: [VizinhoHub - docs/06-contrato-api.md](VizinhoHub%20-%20docs/06-contrato-api.md)
- Estrutura: [VizinhoHub - docs/07-estrutura-do-repositorio.md](VizinhoHub%20-%20docs/07-estrutura-do-repositorio.md)

## 🚀 Deploy (sem Docker)
Banco de produção **nunca** recebe `db/seed.sql` (a API se recusa a subir com contas `@vizinhohub.test`). Variáveis: [`.env.prod.example`](.env.prod.example).
`npm run db:setup` (em `apps/api`) é idempotente: aplica `db/schema.sql` só em banco vazio, roda `db/migrations` e fixa o fuso `America/Fortaleza`; lê `DATABASE_URL` do ambiente.

**API + banco no Render** ([`render.yaml`](render.yaml), Blueprint): New → Blueprint → aponte para o repositório. O build instala `packages/contracts` e `apps/api` (`tsx` está em `dependencies`, então `npm ci --omit=dev` basta), o `preDeployCommand` roda `db:setup` e o start é `npm run start:prod` (`/health` como health check; WebSocket funciona sem config extra). Preencha `CORS_ORIGIN` (domínio do front) e as chaves opcionais.

**Front no Vercel ou Cloudflare Pages** (`apps/web`): build `npm ci && npm run build`, saída `dist`, variável de build `VITE_API_URL=https://<sua-api>/api/v1` (o Socket.io usa a origem dela). SPA/cache já configurados em `apps/web/vercel.json` e `apps/web/public/_redirects` + `_headers`. Como `apps/web` depende de `packages/contracts`, deixe o *root directory* na raiz do repositório e use `cd packages/contracts && npm ci && cd ../../apps/web && npm ci && npm run build`.

**VPS sem container (PM2)**
```bash
# Node 24 + Postgres instalados; crie um banco vazio e preencha .env.prod na raiz (cp .env.prod.example .env.prod)
(cd packages/contracts && npm ci --omit=dev) && (cd apps/api && npm ci --omit=dev)
set -a; . ./.env.prod; set +a            # exporta DATABASE_URL etc. para este shell
(cd apps/api && npm run db:setup)
npm i -g pm2 && pm2 start ecosystem.config.cjs --env production
pm2 save && pm2 startup
# front: (cd apps/web && VITE_API_URL=/api/v1 npm ci && npm run build) e sirva apps/web/dist por qualquer servidor estático
```
Exemplo mínimo de nginx (mesma origem, sem CORS): `root .../apps/web/dist;` · `location / { try_files $uri /index.html; }` · `location /api/ { proxy_pass http://127.0.0.1:3333; }` · `location /socket.io/ { proxy_pass http://127.0.0.1:3333; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }` (e `client_max_body_size 21m;` por causa dos encartes). No Caddy: `reverse_proxy /api/* /socket.io/* 127.0.0.1:3333` e `try_files {path} /index.html` + `file_server`. Sem HTTPS próprio, `CORS_ORIGIN` deve ser o endereço público do site.

**Primeiro lojista em produção** (o cadastro público só cria clientes; o script recusa `NODE_ENV=production`, então rode-o sem essa variável, apontando para o banco de produção):
```bash
cd apps/api && DATABASE_URL="postgresql://..." JWT_SECRET="qualquer-16+-caracteres"   npx tsx scripts/create-merchant.ts --email loja@exemplo.com --name "Dono" --store "Mercadinho X"   --neighborhood Aldeota --city Fortaleza --password "senha-com-8+"
```

## ▶️ Rodando o frontend (ligado à API)
O frontend é uma aplicação **React + Vite** em `apps/web` (o protótipo HTML/CSS original foi preservado em `apps/web-legacy`). Ele consome a API de `apps/api`: produtos, pedidos, login e painel do comerciante vêm do PostgreSQL, com atualização em tempo real por Socket.io.

```bash
# 1) banco + API (veja "Como rodar a API" em VizinhoHub - docs/07-estrutura-do-repositorio.md)
cd apps/api && npm run dev:db        # deixe rodando
cd apps/api && npm run import-catalog && npm run dev   # http://localhost:3333

# 2) frontend
cd apps/web
cp .env.example .env   # VITE_API_URL e (opcional) as chaves do Firebase
npm install
npm run dev            # http://localhost:5173
```

**Contas de desenvolvimento** (senha `vizinho123`): `maria@vizinhohub.test` (cliente) e `ze@vizinhohub.test` (comerciante, abre o painel em `/dashboard`).

**Autenticação:** o login é por e-mail/senha direto na API; com as chaves do Firebase no `.env`, também há login com Google e recuperação de senha (o ID token do Firebase é trocado por um token da API em `POST /auth/firebase`). O **papel** (cliente/comerciante) vem sempre do banco — para promover alguém use `npm run create-merchant` em `apps/api`. As rotas do painel só abrem para comerciantes e a API valida o papel em cada chamada.

**Fluxo em tempo real:** o cliente envia o pedido em `/carrinho` → ele aparece no Kanban (`/manager`) sem recarregar, com aviso e bip → ao avançar o status, a tela `/acompanhar/:id` do cliente muda sozinha. Em ofertas, aparecem os produtos do **Salva-Estoque** (desconto automático perto do vencimento; `npm run import-catalog -- --demo-offers` cria alguns de exemplo).

### ✨ Movimento
Toda a interface usa `apps/web/css/motion.css` (skeleton, lazy loading, entrada/saída, menu, progresso), seguindo a skill [design-motion-principles](https://github.com/kylezantos/design-motion-principles). Sem JavaScript; respeita `prefers-reduced-motion`. Para ver também a **animação de saída entre páginas** (View Transitions), sirva por HTTP: `npx serve apps/web` (em `file://` só a entrada é animada).

### 🛍️ Catálogo do protótipo
`apps/web` traz **437 produtos em 12 departamentos** (Mercearia, Frios e Laticínios, Bebidas, Cervejas, Açougue, Hortifruti, Padaria, Congelados, Doces e Snacks, Limpeza, Higiene e Pet). Páginas: `index.html` (início), `ofertas.html` (todas as promoções), `produtos.html` (catálogo completo por departamento), `carrinho.html`, `login.html`, `manager.html` e `estoque.html`.

### 🧭 Mapa de telas (protótipo HTML/CSS)
**Cliente:** `index.html` (início) · `ofertas.html` · `produtos.html` (catálogo por departamento) · `produto-<id>.html` (detalhe, 437 páginas) · `carrinho.html` · `conta.html` (pedidos, endereços e dados) · `acompanhar.html` (status do pedido) · `loja.html` (perfil da loja) · `login.html`
**Comerciante (menu lateral):** `dashboard.html` · `manager.html` (Kanban) · `pedidos.html` (histórico) · `pedido-detalhe.html` · `estoque.html` · `admin-produto.html` (cadastro) · `categorias.html` · `clientes.html` · `relatorios.html` · `configuracoes.html`
