# Fluxo do Usuário (User Flow)

```
[CLIENTE FINAL] (VizinhoHub Store)
  │
  ├─► 1. Acessa a Vitrine Pública do Bairro
  ├─► 2. Filtra por Categoria / Busca Produto
  ├─► 3. Adiciona ao Carrinho
  └─► 4. Finaliza Pedido ────────┐
                                 │ (WebSocket / Evento em tempo real)
[COMERCIANTE] (VizinhoHub Manager)
  │                              ▼
  ├─► 5. Recebe Alerta Sonoro/Visual no Painel Kanban
  ├─► 6. Visualiza Detalhes da Compra (Status: Pendente)
  ├─► 7. Atualiza Status para "Em Preparação"
  └─► 8. Marca como "Pronto / Concluído"
```

## Estados do pedido
`Pendente` → `Em Preparação` → `Pronto` → `Entregue`

O VizinhoHub não controla estoque de produtos: aceitar (**Em Preparação**) ou cancelar um pedido só muda o status. Quando o item vem de uma oferta com quantidade limitada (relâmpago ou prato do dia), a quantidade da oferta é reservada de forma atômica ao finalizar o pedido (evita *race conditions*) e devolvida se o pedido for cancelado.

Related: [01 — Visão Geral](01-visao-geral.md) · [05 — Modelagem de Dados](05-modelagem-de-dados.md) · [06 — Contrato da API](06-contrato-api.md)
Up: [Índice da documentação](README.md)
