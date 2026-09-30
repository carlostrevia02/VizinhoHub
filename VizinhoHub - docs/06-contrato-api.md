# Contrato da API REST (v1)

Base: `/api/v1`. Autenticação por token (JWT) nas rotas administrativas.

## Produtos & Estoque
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/products` | Lista produtos; filtros `search`, `category` | Pública |
| POST | `/products` | Cadastra produto | ADMIN |
| PUT | `/products/:id` | Atualiza nome, preço ou quantidade | ADMIN |
| PATCH | `/products/:id/stock` | Ajuste rápido de entrada/saída de estoque | ADMIN |

## Pedidos
| Método | Rota | Descrição | Auth |
|---|---|---|---|
| POST | `/orders` | Cria pedido (valida estoque) e emite `order:created` | Cliente |
| GET | `/orders` | Lista pedidos ativos para o Kanban | ADMIN |
| PATCH | `/orders/:id/status` | Transiciona o status (ex.: PENDING → IN_PREPARATION) | ADMIN |

Transições inválidas retornam `409 Conflict`; estoque insuficiente retorna `422`.

## WebSocket
| Evento | Direção | Quando |
|---|---|---|
| `order:created` | servidor → painel Admin | Novo pedido recebido |
| `order:status_updated` | servidor → cliente | Status do pedido alterado |

## Exemplo — `POST /orders`
```json
{ "customerName": "Maria", "items": [{ "productId": 12, "quantity": 2 }] }
```
