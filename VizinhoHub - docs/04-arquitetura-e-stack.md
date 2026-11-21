# Arquitetura e Tecnologias

## Desafios técnicos de engenharia
- **Notificações em tempo real:** WebSockets para atualização instantânea do painel do comerciante.
- **Concorrência em ofertas limitadas:** prevenção de *race conditions* na compra simultânea de ofertas com quantidade limitada (`UPDATE` condicional atômico) e controle otimista de versão na edição de produtos.
- **Arquitetura limpa:** backend desacoplado em camadas (Clean / Layered Architecture).

## Stack planejada
| Camada | Tecnologia |
|---|---|
| Frontend (fase atual) | HTML5 + CSS3 (protótipo de alta fidelidade, sem JavaScript) |
| Frontend (planejado) | Next.js (React), TypeScript, TailwindCSS, Shadcn/ui |
| Backend | Node.js (NestJS / Express) ou Python (FastAPI) |
| Banco de dados | PostgreSQL + Prisma ORM / Drizzle ORM |
| Infraestrutura | Render (API + Postgres), Vercel/Cloudflare Pages (front), PM2 em VPS |

## Componentes
- **VizinhoHub Store** — vitrine pública (Next.js).
- **VizinhoHub Manager** — painel administrativo (Next.js).
- **VizinhoHub Core API** — REST + WebSocket; regras de negócio, ofertas e pedidos.
- **PostgreSQL** — persistência de usuários, produtos, categorias, ofertas e pedidos.

## Camadas do backend
Controllers (HTTP/WS) → Services (casos de uso) → Repositories (acesso a dados) → Banco.

## Sistema de movimento (CSS)
`apps/web/css/motion.css` e `pages.css` implementam skeleton com brilho, carregamento preguiçoso de imagens, animações de entrada/saída de página (View Transitions), menu e gaveta animados, barras de progresso e contadores. Base: skill *design-motion-principles* — só `transform`/`opacity`, easing customizado e `prefers-reduced-motion` respeitado.

Related: [07 — Estrutura do Repositório](07-estrutura-do-repositorio.md) · [08 — Protótipo HTML + CSS](08-prototipo-html-css.md)
Up: [Índice da documentação](README.md)
