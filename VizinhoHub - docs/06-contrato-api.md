# Contrato da API REST (v1)

Base: `/api/v1` (o prefixo antigo `/api` continua valendo). JSON em tudo. Autenticação por `Authorization: Bearer <token>` (JWT da API, 7 dias).
Teste manual: coleção do **Thunder Client** em [`apps/api/thunder`](../apps/api/thunder/README.md) (41 requests cobrindo o fluxo inteiro).

**Erros** têm sempre o formato `{ "error": { "code": "…", "message": "…", "details": … } }` — o front decide a mensagem pelo `code`.

| Status | Quando |
|---|---|
| 400 | corpo/parâmetro inválido (`VALIDATION_ERROR`, com `details[].path`) |
| 401 | sem token, token inválido/expirado, credenciais erradas |
| 403 | papel sem permissão (cliente numa rota de comerciante e vice-versa) |
| 404 | não existe **ou é de outra loja** (não revela a existência) |
| 409 | conflito: e-mail repetido, **transição de status inválida** (`INVALID_TRANSITION`), produto indisponível |
| 422 | regra de negócio: **estoque insuficiente** (`INSUFFICIENT_STOCK`), pedido com várias lojas, produto de outra loja no PDV |
| 429 | muitas tentativas de login |

## Auth
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| POST | `/auth/register` | Cadastro de **cliente** (`name`, `email`, `password` ≥ 8) → `{ token, user }` | Pública |
| POST | `/auth/login` | E-mail e senha → `{ token, user }` | Pública |
| POST | `/auth/firebase` | Troca o **ID token do Firebase** (`idToken`) pelo token da API; cria o cliente no 1º acesso | Pública |
| GET | `/auth/me` | Perfil (e dados da loja, se comerciante) | Logado |
| PATCH | `/auth/me` | Altera `name`; comerciante também `store{name,neighborhood,city,state,latitude,longitude}` | Logado |

- O **papel nunca vem do token nem do corpo**: é lido do banco. Todo cadastro público nasce `CUSTOMER`; comerciante é criado/promovido por `npm run create-merchant`.
- `/auth/firebase` valida a assinatura RS256 contra os certificados públicos do Google (`aud`/`iss` = `FIREBASE_PROJECT_ID`). Uma conta já existente com o mesmo e-mail só é vinculada se o Firebase marcar o e-mail como verificado.

## Vitrine & Estoque
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/categories` | Departamentos + `productCount` | Pública |
| POST | `/categories` | Cria categoria (nome único → 409) | MERCHANT |
| GET | `/products` | Vitrine: só ativo e não vencido, com `effectivePrice`/`discountPct` (Salva-Estoque). Filtros: `search` (sem acento), `category`, `merchantId`, `clearance=true`, `inStock`, `limit` (≤ 500), `offset` | Pública |
| GET | `/products/:id` | Detalhe | Pública |
| GET | `/products/mine` | Todos os produtos ativos da loja (inclui esgotados e vencidos), com campos B2B | MERCHANT |
| POST | `/products` | Cadastra produto (a loja é a do token) | MERCHANT |
| PUT | `/products/:id` | Atualização **parcial** (nome, preço, validade, B2B…); estoque não muda aqui | MERCHANT |
| PATCH | `/products/:id/stock` | Ajuste atômico: `{ "delta": -3 }` (entrada/saída) ou `{ "set": 40 }` (contagem). Saída maior que o saldo → 422 | MERCHANT |
| DELETE | `/products/:id` | Remoção lógica (204) | MERCHANT |

**Salva-Estoque:** `is_clearance` é mantido por `refresh_clearance()` — roda ao subir a API, de hora em hora e a cada cadastro/edição. Vence hoje/amanhã → 50 %, em até 3 dias → 30 %. O preço do pedido é sempre calculado no banco (o cliente nunca informa preço).

## Pedidos
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| POST | `/orders` | Cria pedido `PENDING` (valida estoque, uma loja por pedido) e emite `order:created` | CUSTOMER |
| GET | `/orders` | Comerciante: pedidos da loja (Kanban: `?active=true`); cliente: os próprios. Filtros `status`, `channel`, `limit` | Logado |
| GET | `/orders/:id` | Detalhe (só o dono do pedido ou a loja) | Logado |
| PATCH | `/orders/:id/status` | Transição de status (abaixo) e emite `order:status_updated` | MERCHANT |

**Máquina de estados:** `PENDING → IN_PREPARATION → READY → COMPLETED`; `CANCELLED` a partir de `PENDING` e `IN_PREPARATION`. Qualquer outra transição → **409**.

**Estoque:** a baixa acontece **ao aceitar** (`PENDING → IN_PREPARATION`), em transação, com `UPDATE … WHERE stock_qty >= q` — se faltar qualquer item → **422** e nada muda. Cancelar um pedido `IN_PREPARATION` devolve o estoque. O `FOR UPDATE` no pedido faz duas mudanças simultâneas se enfileirarem (a 2ª vê o status novo e recebe 409).

## Modo PDV
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| POST | `/pos/sales` | Venda de balcão `{ items }`: nasce `COMPLETED` (`channel: POS`, sem cliente) e baixa o estoque na hora. Só produtos da própria loja | MERCHANT |

Histórico: `GET /orders?channel=POS`.

## Rede Anti-Ruptura (B2B)
Um produto entra na rede com `allowB2bSharing: true` + `barcode`; `b2bReserveQty` é o que a loja **não** oferece.
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/b2b/search` | `?barcode=` ou `?productId=` (+ `radiusKm`, padrão 5): quem perto de mim tem excedente, com `distanceKm` | MERCHANT |
| GET | `/b2b/alerts` | Meus produtos esgotados (com código de barras) que a vizinhança consegue suprir | MERCHANT |

## WebSocket (Socket.io, mesma porta)
Handshake autenticado: `io(url, { auth: { token } })`. Comerciante entra na sala `merchant:<id>`, cliente em `customer:<id>`.

| Evento | Direção | Quando |
|---|---|---|
| `order:created` | servidor → loja dona | Novo pedido recebido (payload: `OrderDTO`) |
| `order:status_updated` | servidor → cliente do pedido **e** loja | Status alterado (payload: `OrderDTO`) |

## Exemplo — `POST /orders`
```json
{
  "items": [{ "productId": "aaaaaaaa-0000-4000-8000-000000000001", "quantity": 2 }],
  "customerName": "Maria", "phone": "85999990000",
  "deliveryMethod": "Retirar na loja", "notes": "Sem sacola"
}
```
Os IDs de produto são **UUID** (o catálogo estático do front usa inteiros — a migração do front para a API troca para os IDs vindos de `GET /products`).

Related: [05 — Modelagem de Dados](05-modelagem-de-dados.md) · [07 — Estrutura do Repositório](07-estrutura-do-repositorio.md)
Up: [Índice da documentação](README.md)
