# Protótipo de alta fidelidade (HTML + CSS)

Pasta: `apps/web/` — 455 páginas, sem JavaScript. Tudo que parece interativo usa CSS: abas (`:checked`), filtros (`:has()`), menu, gaveta, interruptores e animações.

## Como executar
```bash
python -m http.server 8080 --directory apps/web
```
Abra http://localhost:8080. Para o comerciante, use *Entrar como Comerciante* na tela de login (`login.html`).

## Catálogo
- **437 produtos** em **12 departamentos**: Mercearia, Frios e Laticínios, Bebidas, Cervejas, Açougue, Hortifruti, Padaria, Congelados, Doces e Snacks, Limpeza, Higiene e Pet.
- **53 ofertas** (produtos com preço antigo riscado e selo de desconto).
- Cada produto tem página própria (`produto-<id>.html`) com abas de descrição, informações e avaliações, e produtos relacionados.
- Imagens: veja `apps/web/img/CREDITS.md`.

## Fluxos
**Cliente:** Início → Ofertas / Produtos → Produto → Carrinho → Acompanhar pedido → Minha conta.

**Comerciante:** Login → Dashboard → Pedidos (Kanban) → Detalhe do pedido → Estoque → Novo produto → Departamentos → Clientes → Relatórios → Configurações.

## Movimento
Skeleton, lazy loading, transições de página, menu/gaveta animados, gráficos e contadores, tudo respeitando `prefers-reduced-motion`. Detalhes em [04-arquitetura-e-stack.md](04-arquitetura-e-stack.md).

## Limites do protótipo
Dados fictícios e sem persistência: botões de salvar/adicionar não executam ações. A lógica (estoque, pedidos em tempo real via WebSocket) virá com a Core API.
