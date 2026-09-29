# VizinhoHub — Visão Geral

**Nome oficial:** VizinhoHub — Plataforma de Gestão de Estoque e Vitrine Virtual para o Pequeno Varejo Comunitário

Projeto de extensão universitária da disciplina de Desenvolvimento de Plataformas Web (Centro de Ciências Tecnológicas, Universidade de Fortaleza — Unifor).

## A. Problema a ser resolvido
Pequenos comércios de bairro em Fortaleza (mercearias, distribuidores de bebidas, hortifrutis e pequenos varejistas) enfrentam três gargalos:

1. **Falta de controle de estoque dinâmico** — vendas presenciais e pedidos via WhatsApp disputam o mesmo estoque sem atualização em tempo real, gerando furos e cancelamentos.
2. **Dependência de processos manuais** — cadernos e planilhas estáticas não se comunicam com o catálogo público do cliente.
3. **Barreira de entrada para e-commerce** — marketplaces cobram comissões de 12% a 25% ou mensalidades inviáveis para o microempreendedor.

## B. Público-alvo
- **Comerciante/Operador (Admin):** donos de pequenos negócios que gerenciam produtos, estoque e pedidos em tempo real.
- **Consumidor (Cliente final):** moradores da comunidade que consultam produtos disponíveis e fazem pedidos de vizinhança.

## C. Impacto social e diferenciais
- **Impacto social:** fortalecimento da economia comunitária e inclusão digital do pequeno varejo local, sem custos de intermediação abusivos.
- **Diferenciais técnicos:**
  - Painel de pedidos atualizado em tempo real via WebSockets (sem refresh).
  - Catálogo público ultrarrápido e otimizado para mobile (mobile-first).
  - Tratamento de concorrência de estoque (não vende o mesmo item para dois clientes simultaneamente).

## D. Objetivos e entregáveis
1. **VizinhoHub Manager** — painel web administrativo: catálogo, relatórios simplificados e monitoramento de pedidos em tempo real.
2. **VizinhoHub Store** — vitrine web pública responsiva: navegar, adicionar ao carrinho e enviar pedido.
3. **VizinhoHub Core API** — API RESTful + canal WebSocket: validação de estoque, mudança de estado do pedido e notificações instantâneas.

## E. Funcionalidades básicas
- **Autenticação & RBAC:** login/cadastro com perfis Comerciante/Admin e Cliente.
- **CRUD de Produtos & Categorias:** cadastrar, listar, editar preço/quantidade e inativar.
- **Gestão de Estoque:** entrada/saída de itens e alertas visuais de estoque baixo.
- **Mural de Pedidos em Tempo Real (Kanban):** `Pendente` → `Em Preparação` → `Pronto` → `Entregue`.
- **Carrinho & Checkout:** seleção de itens e envio do resumo do pedido, com contato direto via WhatsApp.
