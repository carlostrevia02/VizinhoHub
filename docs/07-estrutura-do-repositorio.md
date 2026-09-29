# Estrutura do Repositório (monorepo simples)

```
vizinho-hub/
├── apps/
│   ├── web/                # Frontend (HTML, CSS e JavaScript puro)
│   │   ├── index.html      # Vitrine (Store)
│   │   ├── manager.html    # Painel do comerciante (Kanban + estoque)
│   │   ├── css/style.css
│   │   └── js/             # data.js (camada de dados), store.js, manager.js
│   └── api/                # Backend (Node.js / Express ou NestJS)
│       └── src/
│           ├── modules/    # products, orders, users
│           ├── shared/     # middlewares, utilitários, WebSocket gateway
│           └── server.ts
├── docs/                   # Documentação, DER e slides
├── docker-compose.yml      # PostgreSQL local
├── .env.example
└── README.md
```

## Como subir o banco
```bash
docker compose up -d
```
O `schema.sql` é aplicado automaticamente na primeira inicialização.

## Checklist da Etapa 2
- [x] Repositório `vizinho-hub` criado e ligado à pasta do projeto
- [x] `docker-compose.yml` com PostgreSQL
- [x] DER (Mermaid em `05-modelagem-de-dados.md` e imagem `der.svg`)
- [x] Contrato da API e estrutura de pastas

## Frontend atual (HTML/CSS/JS)
Abra `apps/web/index.html` no navegador (ou `npx serve apps/web`). Os dados ficam no `localStorage` e os eventos `order:created` / `order:status_updated` são simulados com `BroadcastChannel` entre abas — abra a vitrine e o `manager.html` lado a lado. Quando a Core API existir, `js/data.js` é o único ponto a trocar por chamadas REST/WebSocket.
