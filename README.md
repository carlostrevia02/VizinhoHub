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
- **Frontend:** HTML, CSS e JavaScript (fase atual; migração para Next.js/React planejada)
- **Backend:** Node.js (NestJS / Express) ou Python (FastAPI)
- **Banco de Dados:** PostgreSQL + Prisma ORM / Drizzle ORM
- **Infraestrutura:** Docker & Docker Compose

## 📚 Documentação
- [01 — Visão Geral](01-visao-geral.md)
- [02 — Fluxo do Usuário](02-fluxo-do-usuario.md)
- [03 — Wireframes](03-wireframes.md)
- [04 — Arquitetura e Stack](04-arquitetura-e-stack.md)
- Slides: `VizinhoHub-Etapa1.pptx`

## 🚀 Setup local (Etapa 2)
```bash
cp .env.example .env
docker compose up -d   # PostgreSQL em localhost:5432 com o schema aplicado
```
- Modelagem: [VizinhoHub - docs/05-modelagem-de-dados.md](VizinhoHub%20-%20docs/05-modelagem-de-dados.md) · [DER](VizinhoHub%20-%20docs/der.svg)
- Contrato da API: [VizinhoHub - docs/06-contrato-api.md](VizinhoHub%20-%20docs/06-contrato-api.md)
- Estrutura: [VizinhoHub - docs/07-estrutura-do-repositorio.md](VizinhoHub%20-%20docs/07-estrutura-do-repositorio.md)

## ▶️ Rodando o protótipo web
Abra `apps/web/index.html` (vitrine) e `apps/web/manager.html` (painel) em abas lado a lado. Os pedidos feitos na vitrine aparecem no Kanban em tempo real.

### ✨ Movimento
Toda a interface usa `apps/web/css/motion.css` (skeleton, lazy loading, entrada/saída, menu, progresso), seguindo a skill [design-motion-principles](https://github.com/kylezantos/design-motion-principles). Sem JavaScript; respeita `prefers-reduced-motion`. Para ver também a **animação de saída entre páginas** (View Transitions), sirva por HTTP: `npx serve apps/web` (em `file://` só a entrada é animada).

### 🛍️ Catálogo do protótipo
`apps/web` traz **437 produtos em 12 departamentos** (Mercearia, Frios e Laticínios, Bebidas, Cervejas, Açougue, Hortifruti, Padaria, Congelados, Doces e Snacks, Limpeza, Higiene e Pet). Páginas: `index.html` (início), `ofertas.html` (todas as promoções), `produtos.html` (catálogo completo por departamento), `carrinho.html`, `login.html`, `manager.html` e `estoque.html`.

### 🧭 Mapa de telas (protótipo HTML/CSS)
**Cliente:** `index.html` (início) · `ofertas.html` · `produtos.html` (catálogo por departamento) · `produto-<id>.html` (detalhe, 437 páginas) · `carrinho.html` · `conta.html` (pedidos, endereços e dados) · `acompanhar.html` (status do pedido) · `loja.html` (perfil da loja) · `login.html`
**Comerciante (menu lateral):** `dashboard.html` · `manager.html` (Kanban) · `pedidos.html` (histórico) · `pedido-detalhe.html` · `estoque.html` · `admin-produto.html` (cadastro) · `categorias.html` · `clientes.html` · `relatorios.html` · `configuracoes.html`
