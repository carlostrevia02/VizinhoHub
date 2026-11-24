# Diagramas do VizinhoHub

Conjunto de diagramas do projeto de extensão (Unifor). Cada diagrama tem a fonte Mermaid (`.mmd`) e as imagens `.png` (escala 2) e `.svg`. Para editar, altere o `.mmd` e gere de novo com `mmdc -i arquivo.mmd -o arquivo.png -s 2` (e `.svg`).

Fatos conferidos em `db/schema.sql`, `apps/api/src`, `apps/web/src/App.jsx`, `apps/mcp-server` e `packages/contracts`. O VizinhoHub é um intermediário de descontos: não há estoque de produto, B2B, Departamentos nem Encartes no Manager. Só as ofertas relâmpago e o prato do dia têm quantidade limitada.

| Nº | Nome | Tipo | O que mostra | Arquivo |
|---|---|---|---|---|
| 01 | Casos de uso | UML (casos de uso) | Atores (cliente, comerciante, entregador, gerente de rede, sistema/IA) e os casos de uso agrupados por vitrine, pedidos e cupons, painel, logística, encartes e automação | `01-casos-de-uso` |
| 02 | Classes de domínio | UML (classes) | Classes principais com atributos e métodos: User, Customer, Merchant, Courier, Product, Order, OrderItem, FlashOffer, Deal, DealCoupon, Delivery, VipSubscription e relações | `02-classes-dominio` |
| 03 | DER do núcleo | Modelo entidade-relacionamento | Tabelas do núcleo (users, addresses, categories, products, orders, order_items, flash_offers e claims, deliveries, couriers, redes, deals, cupons) com PK e FK | `03-der-completo` |
| 04 | DER dos módulos avançados | Modelo entidade-relacionamento | Logística, caderneta, agenda de encomendas, combos e prato do dia, Clube VIP, carrinho inteligente e funil (visão geral compacta) | `04-der-modulos-avancados` |
| 04a | DER: logística, caderneta e agenda | Modelo entidade-relacionamento | Parte 1 do 04, em tamanho legível para slide | `04a-der-logistica-caderneta-agenda` |
| 04b | DER: VIP, carrinho e combos | Modelo entidade-relacionamento | Parte 2 do 04, em tamanho legível para slide | `04b-der-vip-carrinho-combos` |
| 05 | Contexto (C4 nível 1) | C4 | Pessoas, o VizinhoHub e os sistemas externos (Firebase Auth, Claude API, OSRM/OpenStreetMap, Asaas, WhatsApp, redes de supermercado) | `05-contexto-c4` |
| 06 | Containers (C4 nível 2) | C4 | Web PWA, Core API (REST, Socket.io e jobs), PostgreSQL, MCP Server e pacote contracts | `06-containers-c4` |
| 07 | Camadas do back-end | Arquitetura | Fluxo routes, service e repository, schema zod, eventos, `shared/` e os módulos de `apps/api/src/modules` | `07-camadas-backend` |
| 08 | Pedido em tempo real | UML (sequência) | Cliente cria o pedido, o painel recebe `order:created` e o status muda com `order:status_updated` | `08-sequencia-pedido-tempo-real` |
| 09 | Disputa pela última unidade | UML (sequência) | Dois clientes e o UPDATE condicional atômico: um recebe `422 FLASH_UNAVAILABLE` | `09-sequencia-oferta-concorrencia` |
| 10 | Cupom das ofertas do bairro | UML (sequência) | Job lê a página, Claude extrai, validação e `deals`; cliente gera e confirma o cupom | `10-sequencia-cupom-ofertas-bairro` |
| 11 | Estados do pedido | UML (máquina de estados) | PENDING, IN_PREPARATION, READY, COMPLETED e CANCELLED; `409 INVALID_TRANSITION` | `11-estados-pedido` |
| 12 | Estados do cupom | UML (máquina de estados) | ACTIVE, REDEEMED e EXPIRED, com validade de 24 h | `12-estados-cupom` |
| 13 | Atividades do cliente | UML (atividades) | Da vitrine ao pedido ou cupom, com as decisões e a entrega | `13-atividades-cliente` |
| 14 | Atividades do lojista | UML (atividades) | Cadastro, oferta, atendimento do pedido, entrega e relatórios | `14-atividades-lojista` |
| 15 | DFD nível 0 | Diagrama de fluxo de dados | Contexto: fluxos entre o VizinhoHub e as entidades externas | `15-fluxo-dados-dfd` |
| 15b | DFD nível 1 | Diagrama de fluxo de dados | Seis processos, seis depósitos de dados e os fluxos entre eles | `15b-fluxo-dados-dfd-nivel1` |
| 16 | Implantação | UML (implantação) | Render e Vercel/Cloudflare, alternativa com PM2 e nginx em VPS, serviços externos | `16-implantacao` |
| 17 | Mapa de telas | Mapa mental | Rotas reais de `apps/web/src/App.jsx`: vitrine, entregador e painel do comerciante | `17-mapa-de-telas` |
| 18 | Cronograma | Gantt | Cinco etapas de 29/09/2026 a 30/11/2026 | `18-cronograma-gantt` |
| 19 | Requisitos | Mapa mental | Requisitos funcionais por módulo e requisitos não funcionais | `19-mapa-mental-requisitos` |
| 20 | Segurança e LGPD | Fluxo | Autenticação, autorização, limites, dados sensíveis e retenção (GPS 30 dias, funil 90 dias, pedidos 5 anos, PIN apagado) | `20-seguranca-e-lgpd` |

Observações:
- O diagrama 01 é vertical (formato A4 em pé). Os diagramas 13, 14 e 15b também são verticais. Para slides, prefira 02, 05 a 12, 15, 16, 18 e 20.
- O DER 04 reúne tudo em uma imagem larga; use 04a e 04b nos slides.
- As tabelas `stock_movements` e a coluna `products.stock_qty` ainda existem no `schema.sql` por compatibilidade (migração 019), mas ficaram de fora dos DER porque o estoque de produto não existe mais.
