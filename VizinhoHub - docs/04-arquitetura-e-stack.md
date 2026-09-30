# Arquitetura e Tecnologias

## Desafios técnicos de engenharia
- **Notificações em tempo real:** WebSockets para atualização instantânea do painel do comerciante.
- **Integridade transacional de estoque:** prevenção de *race conditions* na venda simultânea de itens escassos (ex.: transações com bloqueio de linha / controle otimista de versão).
- **Arquitetura limpa:** backend desacoplado em camadas (Clean / Layered Architecture).

## Stack planejada
| Camada | Tecnologia |
|---|---|
| Frontend (fase atual) | HTML5 + CSS3 (protótipo de alta fidelidade, sem JavaScript) |
| Frontend (planejado) | Next.js (React), TypeScript, TailwindCSS, Shadcn/ui |
| Backend | Node.js (NestJS / Express) ou Python (FastAPI) |
| Banco de dados | PostgreSQL + Prisma ORM / Drizzle ORM |
| Infraestrutura | Docker & Docker Compose |

## Componentes
- **VizinhoHub Store** — vitrine pública (Next.js).
- **VizinhoHub Manager** — painel administrativo (Next.js).
- **VizinhoHub Core API** — REST + WebSocket; regras de negócio, estoque e pedidos.
- **PostgreSQL** — persistência de usuários, produtos, categorias, estoque e pedidos.

## Camadas do backend
Controllers (HTTP/WS) → Services (casos de uso) → Repositories (acesso a dados) → Banco.

## Sistema de movimento (CSS)
`apps/web/css/motion.css` e `pages.css` implementam skeleton com brilho, carregamento preguiçoso de imagens, animações de entrada/saída de página (View Transitions), menu e gaveta animados, barras de progresso e contadores. Base: skill *design-motion-principles* — só `transform`/`opacity`, easing customizado e `prefers-reduced-motion` respeitado.
