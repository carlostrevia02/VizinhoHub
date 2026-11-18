# Estrutura do Repositório

```
vizinho-hub/
├── apps/
│   ├── web/                     # Frontend React + Vite (vitrine + painel) ligado à API · Firebase só para identidade
│   │   ├── src/{pages,components,context,lib,data,styles}
│   │   └── public/img/          # 440 imagens de produtos
│   ├── web-legacy/              # Protótipo HTML + CSS original (referência visual)
│   └── api/                     # Core API — Node.js + TypeScript + Express 5 + Socket.io
│       ├── src/
│       │   ├── server.ts        # sobe HTTP + WebSocket
│       │   ├── app.ts           # composição (rotas, serviços, realtime)
│       │   ├── shared/          # env, db (pool/transação), errors, auth (JWT), realtime (Socket.io)
│       │   └── modules/
│       │       └── orders/      # schema (zod) → repository (SQL) → service (regras) → routes (HTTP)
│       ├── scripts/dev-token.ts # token de desenvolvimento para usuários do seed
│       └── test/                # integração: Postgres embutido + HTTP + Socket.io
├── packages/
│   └── contracts/               # Contratos compartilhados (DTOs, eventos, schemas)
├── db/
│   ├── schema.sql               # fonte única do banco (tabelas, índices, funções, views)
│   └── seed.sql                 # dados de desenvolvimento (2 mercadinhos na Aldeota + 1 cliente)
├── VizinhoHub - docs/           # Documentação (cofre Obsidian), DER, slides e documento técnico
├── render.yaml                  # Blueprint do Render (API + Postgres)
├── ecosystem.config.cjs         # PM2 (alternativa em VPS)
├── .env.example
└── README.md
```

Todos os módulos seguem o formato de `orders/` (schema zod → repository SQL → service → routes): `auth/`, `categories/`, `products/` (Salva-Estoque), `orders/`, `pos/` (Modo PDV) e `b2b/` (Rede Anti-Ruptura).

## Por que Node.js + TypeScript + Express + Socket.io
- **Tempo real nativo:** Socket.io roda no mesmo processo/porta da API, com salas por mercadinho (`merchant:<id>`).
- **Uma linguagem no projeto inteiro:** os tipos dos eventos (`OrderDTO`) podem ser compartilhados com o frontend.
- **SQL explícito (`pg`)** nas regras críticas: transações e baixa de estoque atômica (`UPDATE … WHERE stock_qty >= $q`) ficam visíveis e testáveis.

## Como subir o banco
```bash
cp .env.example .env
cd apps/api && npm install && npm run dev:db   # Postgres embutido (sem Docker); deixe rodando
```
`db/schema.sql` e `db/seed.sql` rodam automaticamente só na **primeira** subida. Para recriar do zero: pare o processo e apague `apps/api/.pgdata`. Em produção/homologação use `npm run db:setup` (sem seed) — veja "Deploy (sem Docker)" no README.

## Como rodar a API
```bash
cd apps/api
npm install
npm run dev:db                                # Postgres local (embutido, sem Docker); deixe rodando
npm run import-catalog                        # 1ª vez: 437 produtos do front → loja do Zé (idempotente)
npm run dev                                   # http://localhost:3333  (base /api/v1)
npm run create-merchant -- --email x@y.com --store "Loja" --neighborhood Aldeota --city Fortaleza --password ...
npm run dev-token -- maria@vizinhohub.test    # token de desenvolvimento (JWT) de um usuário do seed
npm test                                      # testes de integração (Postgres embutido, sem instalar nada além do Node)
```
Usuários do seed entram por `POST /auth/login` com a senha `vizinho123` (só desenvolvimento). Teste manual: coleção do Thunder Client em [`apps/api/thunder`](../apps/api/thunder/README.md).

## Checklist
- [x] Postgres local embutido (`npm run dev:db`) e deploy sem Docker (`render.yaml`, PM2)
- [x] `schema.sql` com índices de validade, bairro/geolocalização, Kanban e busca
- [x] Frontend React (vitrine + painel) com login Firebase
- [x] Core API: criação de pedidos + evento WebSocket `order:created`
- [x] Auth: cadastro/login próprios + troca de ID token do Firebase por token da API
- [x] Produtos & categorias (CRUD, vitrine pública com busca sem acento, ajuste atômico de estoque)
- [x] Kanban: mudança de status com baixa de estoque atômica (e devolução ao cancelar) + `order:status_updated`
- [x] Salva-Estoque (job `refresh_clearance()` + vitrine)
- [x] Rede Anti-Ruptura B2B (`/b2b/search`, `/b2b/alerts`)
- [x] Modo PDV (`/pos/sales`)
- [x] Ligar o frontend à API (catálogo, login/papéis, pedidos com tempo real e painel do comerciante; Firestore removido)
- [ ] Migração para Next.js (adiada para depois do MVP; decisão de 16/11/2026)
- [x] Ofertas relâmpago (Tá Quentinho)
- [x] Pacote de contratos `packages/contracts`
- [x] Teardown confiável do Postgres de teste
- [x] Logística (`modules/delivery`: taxa e raio, pool de entregadores, rastreio, PIN e limpeza do GPS)
- [x] Carrinho Inteligente (`modules/smart-cart`: receitas, listas e otimizador de menor custo)
- [x] Caderneta, encomendas, combos e prato do dia (`modules/credit`, `scheduling` e `daily-menu`)
- [x] Clube VIP (`modules/vip`: adapter mock/Asaas, webhook idempotente, desconto e frete grátis por adesão)
- [x] Retenção LGPD (funil 90 dias, GPS 30 dias, pedidos e caderneta 5 anos)

Related: [04 — Arquitetura e Stack](04-arquitetura-e-stack.md) · [06 — Contrato da API](06-contrato-api.md)
Up: [Índice da documentação](README.md)
