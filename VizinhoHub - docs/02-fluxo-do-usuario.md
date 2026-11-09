# Fluxo do Usuário (User Flow)

```
[CLIENTE FINAL] (VizinhoHub Store)
  │
  ├─► 1. Acessa a Vitrine Pública do Bairro
  ├─► 2. Filtra por Categoria / Busca Produto
  ├─► 3. Adiciona ao Carrinho (Sistema valida estoque)
  └─► 4. Finaliza Pedido ────────┐
                                 │ (WebSocket / Evento em tempo real)
[COMERCIANTE] (VizinhoHub Manager)
  │                              ▼
  ├─► 5. Recebe Alerta Sonoro/Visual no Painel Kanban
  ├─► 6. Visualiza Detalhes da Compra (Status: Pendente)
  ├─► 7. Atualiza Status para "Em Preparação" (dedução automática do estoque)
  └─► 8. Marca como "Pronto / Concluído"
```

## Estados do pedido
`Pendente` → `Em Preparação` → `Pronto` → `Entregue`

A dedução definitiva do estoque ocorre na transição para **Em Preparação**; a validação de disponibilidade ocorre já ao adicionar ao carrinho/finalizar pedido, com tratamento de concorrência (evita *race conditions*).

Related: [01 — Visão Geral](01-visao-geral.md) · [05 — Modelagem de Dados](05-modelagem-de-dados.md) · [06 — Contrato da API](06-contrato-api.md)
Up: [Índice da documentação](README.md)
