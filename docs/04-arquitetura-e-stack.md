# Arquitetura e Tecnologias

## Desafios técnicos de engenharia
- **Notificações em tempo real:** WebSockets para atualização instantânea do painel do comerciante.
- **Integridade transacional de estoque:** prevenção de *race conditions* na venda simultânea de itens escassos (ex.: transações com bloqueio de linha / controle otimista de versão).
- **Arquitetura limpa:** backend desacoplado em camadas (Clean / Layered Architecture).

## Stack planejada
| Camada | Tecnologia |
|---|---|
| Frontend | Next.js (React), TypeScript, TailwindCSS, Shadcn/ui |
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
