# Modelagem de Dados (DER)

Banco relacional: **PostgreSQL**. Script completo em [schema.sql](../db/schema.sql); imagem em [der.svg](der.svg).

## Diagrama

```mermaid
erDiagram
    USERS ||--o{ PRODUCTS : cadastra
    CATEGORIES ||--o{ PRODUCTS : classifica
    ORDERS ||--|{ ORDER_ITEMS : contem
    PRODUCTS ||--o{ ORDER_ITEMS : compoe

    USERS { bigint id PK; string name; string email; enum role }
    CATEGORIES { bigint id PK; string name }
    PRODUCTS { bigint id PK; bigint user_id FK; bigint category_id FK; string name; decimal price; int stock_qty }
    ORDERS { bigint id PK; string customer_name; decimal total_price; enum status; timestamp created_at }
    ORDER_ITEMS { bigint id PK; bigint order_id FK; bigint product_id FK; int quantity; decimal unit_price }
```

## Entidades
| Entidade | Papel |
|---|---|
| Users | Comerciantes (ADMIN) e clientes; base do RBAC |
| Categories | Agrupam produtos (Bebidas, Mercearia, Limpeza…) |
| Products | Catálogo e estoque (`stock_qty`) |
| Orders | Cabeçalho do pedido, com status e total |
| OrderItems | Itens do pedido; `unit_price` guarda o preço no momento da compra |

## Máquina de estados do pedido
`PENDING` → `IN_PREPARATION` → `READY` → `COMPLETED`, com `CANCELLED` possível a partir de PENDING e IN_PREPARATION.

## Integridade de estoque
- `CHECK (stock_qty >= 0)` impede saldo negativo no nível do banco.
- Baixa de estoque em transação com `UPDATE products SET stock_qty = stock_qty - :q WHERE id = :id AND stock_qty >= :q`; se 0 linhas forem afetadas, o pedido é recusado (sem *race condition*).
- `unit_price` em OrderItems preserva o histórico se o preço mudar depois.

Related: [06 — Contrato da API](06-contrato-api.md) · [07 — Estrutura do Repositório](07-estrutura-do-repositorio.md)
Up: [Índice da documentação](README.md)
