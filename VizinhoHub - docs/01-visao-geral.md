# VizinhoHub — Visão Geral

**Nome oficial:** VizinhoHub — Plataforma de Vitrine Virtual e Ofertas dos Supermercados do Bairro

Projeto de extensão universitária da disciplina de Desenvolvimento de Plataformas Web (Centro de Ciências Tecnológicas, Universidade de Fortaleza — Unifor).

## A. Problema a ser resolvido
Pequenos comércios de bairro em Fortaleza (mercearias, distribuidores de bebidas, hortifrutis e pequenos varejistas) enfrentam três gargalos:

1. **Descontos pouco visíveis** — as promoções dos supermercados e mercadinhos do bairro ficam espalhadas em encartes e mensagens; o morador não sabe onde está o melhor preço perto de casa.
2. **Dependência de processos manuais** — cadernos e planilhas estáticas não se comunicam com o catálogo público do cliente.
3. **Barreira de entrada para e-commerce** — marketplaces cobram comissões de 12% a 25% ou mensalidades inviáveis para o microempreendedor.

## B. Público-alvo
- **Comerciante/Operador (Admin):** donos de pequenos negócios que gerenciam produtos, ofertas e pedidos em tempo real.
- **Consumidor (Cliente final):** moradores da comunidade que consultam produtos disponíveis e fazem pedidos de vizinhança.

## C. Impacto social e diferenciais
- **Impacto social:** fortalecimento da economia comunitária e inclusão digital do pequeno varejo local, sem custos de intermediação abusivos.
- **Diferenciais técnicos:**
  - Painel de pedidos atualizado em tempo real via WebSockets (sem refresh).
  - Catálogo público ultrarrápido e otimizado para mobile (mobile-first).
  - Tratamento de concorrência nas ofertas de quantidade limitada (relâmpago e prato do dia): a mesma unidade nunca é vendida a dois clientes ao mesmo tempo. O VizinhoHub é um intermediário de descontos, sem filial nem mercadoria própria, então não controla estoque de produtos.

## D. Objetivos e entregáveis
1. **VizinhoHub Manager** — painel web administrativo: catálogo, relatórios simplificados e monitoramento de pedidos em tempo real.
2. **VizinhoHub Store** — vitrine web pública responsiva: navegar, adicionar ao carrinho e enviar pedido.
3. **VizinhoHub Core API** — API RESTful + canal WebSocket: regras das ofertas, mudança de estado do pedido e notificações instantâneas.

## E. Funcionalidades básicas
- **Autenticação & RBAC:** login/cadastro com perfis Comerciante/Admin e Cliente.
- **CRUD de Produtos & Categorias:** cadastrar, listar, editar preço/quantidade e inativar.
- **Mural de Pedidos em Tempo Real (Kanban):** `Pendente` → `Em Preparação` → `Pronto` → `Entregue`.
- **Carrinho & Checkout:** seleção de itens e envio do resumo do pedido, com contato direto via WhatsApp.

## F. Escopo atual do protótipo (HTML + CSS)
**Cliente (VizinhoHub Store):** início com banners e ofertas · ofertas (todas as promoções) · catálogo completo por departamento (**437 produtos em 12 departamentos**) · página de detalhe de cada produto · carrinho e finalização · minha conta (pedidos, endereços, dados) · acompanhamento do pedido · perfil da loja.

**Comerciante (VizinhoHub Manager):** dashboard · mural Kanban de pedidos · histórico e detalhe do pedido · cadastro de produto · departamentos · clientes · relatórios · configurações da loja.

Related: [02 — Fluxo do Usuário](02-fluxo-do-usuario.md) · [03 — Telas e Protótipos](03-wireframes.md)
Up: [Índice da documentação](README.md)
