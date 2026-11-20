# Roadmap dos módulos avançados

Plano para Logística, Engajamento, Operação da loja e PWA em cima do que **já existe** no repositório. O schema novo está em `db/migrations/004` a `009` (testado em [`apps/api/test/modulos-schema.test.ts`](../apps/api/test/modulos-schema.test.ts)).

## 1. O que já existe (não refazer)

| Pedido | Situação hoje |
|---|---|
| Dashboard analítico (KPIs, picos por hora, curva ABC, pagamentos) | **Feito**: vendas = pedido online + cupom de oferta confirmado (`REDEEMED`), com KPI de lucro, divisão por canal, top ofertas e top clientes; `apps/api/src/modules/analytics` + índices `003-analytics-indices.sql`. Falta só **Conversão** (visitas → pedidos): nada registra visitas. → `store_events` (005) |
| Anti-race condition de estoque | **Feito** para pedidos: `UPDATE … WHERE stock_qty >= q` + `CHECK (stock_qty >= 0)` em `orders.repository.ts`. Falta estender a ofertas relâmpago, fiado, vagas e prato do dia (006, 008) |
| WebSocket + som no caixa | **Feito**: Socket.io com salas `merchant:<id>` / `customer:<id>`, evento `order:created`, aviso com bip no Kanban |
| Salva-Estoque (desconto por validade) | **Feito**; a oferta relâmpago é a versão deliberada e geolocalizada dele |
| Rede B2B, PDV, Ofertas do Bairro, endereços | **Feitos** |

Tudo o resto do pedido é novo.

## 2. Decisão de arquitetura: React + Vite no front, API atual mantida

O front continua **React + Vite** (`apps/web`), como PWA separado, falando com **Express + Socket.io** (`apps/api`). A migração para Next.js foi adiada para depois do MVP (decisão de 16/11/2026). Next.js é opção futura, não o plano atual.

- **`apps/api` continua sendo o backend.** WebSocket persistente não roda em funções serverless (Vercel), e a API já tem pedidos, produtos, auth, ofertas, B2B, PDV, analytics, jobs e testes de integração.
- **Contratos compartilhados** (DTOs, eventos do socket, schemas zod) ficam em `packages/contracts`, que já existe. Isso mantém uma eventual migração barata.

Se o Next for adotado no futuro, ele continua só chamando a API. Next full-stack com Prisma/Drizzle não está em consideração, porque o WebSocket precisaria de um servidor separado de qualquer jeito.

## 3. Mapa do schema novo

| Migração | Módulo | Tabelas / mudanças principais |
|---|---|---|
| `004-logistica` | Flash, pool, rastreio, PIN | `store_delivery_config`, `couriers`, `deliveries`, `delivery_offers`, `courier_location_log`; `orders.fulfillment/delivery_fee/delivery_lat/lng`; `addresses.latitude/longitude`; função `distance_m()` |
| `005-operacao-loja` | Conversão, impressão, push, auditoria | `store_events`, `print_jobs`, `push_subscriptions`, `stock_movements`; `products.version` |
| `006-ofertas-relampago` | Tá Quentinho | `flash_offers`, `flash_offer_claims`, `offer_alert_subscriptions`, `offer_notifications`; view `v_flash_offers_live` |
| `007-carrinho-inteligente` | Receita → menor custo | `canonical_products`, `recipes`, `recipe_ingredients`, `shopping_lists(+items)`; `products.canonical_id`; view `v_canonical_offers` |
| `008-caderneta-encomendas-combos` | Fiado, agenda, combos, prato do dia | `credit_accounts`, `credit_ledger`, `pickup_slots`, `slot_bookings`, `combo_items`, `daily_menu`; `orders.scheduled_for/slot_id/deposit_amount`; `products.kind/lead_time_hours` |
| `009-clube-vip` | Selo Vizinho VIP | `vip_plans`, `vip_tiers`, `vip_subscriptions`, `vip_invoices`, `vip_merchants`; `orders.vip_savings`; função `vip_discount_pct()` |

Escolhas que valem conhecer:

- **Entregador não é um papel novo em `user_role`.** É um perfil (`couriers`) de um usuário comum, então nenhum código que testa `MERCHANT`/`CUSTOMER` muda.
- **`orders.total_price` continua sendo só a mercadoria**, porque o Dashboard soma essa coluna como faturamento. O cliente paga `total_price + delivery_fee`.
- **Sem enums novos**: `VARCHAR + CHECK`, como `deals` já faz. Evita `ALTER TYPE` em migração idempotente.
- **Dinheiro tem livro-razão**: `credit_ledger` (só insere) e `stock_movements` explicam cada mudança de saldo.
- **PIN fica em texto** porque o app do cliente precisa reexibi-lo. A defesa é o limite de 5 tentativas (`pin_attempts`), com bloqueio que só o lojista libera.

## 4. Anti-race condition: um padrão só, em todo lugar

Regra: **o `UPDATE` condicional é o lock**. Ele decide no banco, sem ler-e-gravar, e a linha fica travada até o `COMMIT`. `SELECT … FOR UPDATE` só entra quando uma regra precisa *ler* antes de decidir. Todos os casos abaixo estão no teste com 6 a 30 transações simultâneas.

| Caso | Instrução atômica | Resultado medido |
|---|---|---|
| Oferta relâmpago | `UPDATE flash_offers SET qty_available = qty_available - q WHERE … AND qty_available >= q` → claim por cliente (`ON CONFLICT … WHERE qty + q <= limite`) → `UPDATE products … stock_qty >= q`, nessa ordem (evita deadlock) | 30 clientes, 5 unidades: **vendeu 5**, estoque fecha |
| Limite por cliente | `INSERT … ON CONFLICT DO UPDATE … WHERE` | 6 tentativas, limite 2: **2 passam**, rollback devolve o resto |
| Fiado | `UPDATE credit_accounts SET balance = balance + v WHERE balance + v <= credit_limit` | 20 compras de R$ 10, limite R$ 100: **10 passam**, saldo = soma do livro |
| Vaga de encomenda | `INSERT … ON CONFLICT DO UPDATE … WHERE booked < capacity` | 10 reservas, capacidade 3: **3 entram** |
| Prato do dia | `UPDATE daily_menu … WHERE is_on AND qty_available >= q` | 10 pedidos, 4 porções: **4 vendem** |
| Aceite de corrida | `UPDATE deliveries SET courier_id = c WHERE courier_id IS NULL` | 8 entregadores: **1 leva** |

Edição pelo lojista usa **bloqueio otimista**: `WHERE id = $1 AND version = $2` e `version + 1`; 0 linhas vira HTTP 409. A baixa de venda não usa `version`, para não brigar com edições.

## 5. Estrutura de diretórios

### 5.1 Monorepo

```
vizinho-hub/
├── apps/
│   ├── api/                    # Express + Socket.io (existente; ganha módulos novos)
│   ├── web/                    # React + Vite + PWA (Next.js adiado; ver seção 8)
│   └── web-legacy/             # protótipo HTML/CSS (referência visual)
├── packages/
│   └── contracts/              # DTOs, eventos do socket e schemas zod compartilhados
├── db/
│   ├── schema.sql              # fonte para bancos novos (já inclui 004–013 no final)
│   ├── migrations/             # 001…013 (sem 011), idempotentes
│   └── seed.sql
└── VizinhoHub - docs/
```

### 5.2 `apps/web` (referência para uma futura migração a Next.js)

O front segue em React + Vite (decisão da seção 8). A árvore abaixo fica como alvo se a migração acontecer depois do MVP; hoje as telas vivem em `apps/web/src/pages/{store,admin,courier}` e a lógica compartilhada em `apps/web/src/lib`.

```
apps/web/
├── public/
│   ├── manifest.webmanifest        # ou gerado por app/manifest.ts
│   ├── icons/                      # 192, 512, maskable
│   └── sounds/new-order.mp3        # opcional; o alerta principal usa Web Audio
├── src/
│   ├── app/
│   │   ├── manifest.ts             # um manifesto por escopo (loja, lojista, entregador)
│   │   ├── sw.ts                   # Service Worker (Serwist): cache + push + sync
│   │   ├── (loja)/                 # cliente: vitrine pública, SSR
│   │   │   ├── page.tsx            # início
│   │   │   ├── ofertas/            # Salva-Estoque + Ofertas do Bairro
│   │   │   ├── radar/              # Tá Quentinho (geolocalizado)
│   │   │   ├── flash/              # Vizinho Flash
│   │   │   ├── receitas/[slug]/    # Carrinho Inteligente
│   │   │   ├── lista/              # cesta básica / lista de compras
│   │   │   ├── encomendas/         # calendário de agendamento
│   │   │   ├── clube/              # Selo VIP
│   │   │   ├── carrinho/ · checkout/
│   │   │   ├── pedidos/[id]/       # acompanhamento: mapa + PIN
│   │   │   ├── caderneta/          # extrato do fiado do cliente
│   │   │   └── conta/
│   │   ├── (lojista)/painel/       # protegido por papel MERCHANT
│   │   │   ├── layout.tsx          # sidebar + provider de realtime + som do caixa
│   │   │   ├── analitico/          # dashboard (filtros no URL: ?de=&ate=)
│   │   │   ├── pedidos/            # Kanban
│   │   │   ├── entregas/           # chamar pool, acompanhar
│   │   │   ├── estoque/ · combos/ · prato-do-dia/
│   │   │   ├── ofertas-relampago/
│   │   │   ├── caderneta/          # limites, devedores, acerto
│   │   │   ├── agenda/             # encomendas + faixas de horário
│   │   │   ├── impressao/          # pareamento e teste da impressora
│   │   │   └── configuracoes/
│   │   ├── (entregador)/corridas/  # PWA do entregador: chamados, rota, digitar PIN
│   │   ├── login/
│   │   └── api/                    # só o que precisa ser same-origin: push subscribe, auth cookie
│   ├── features/                   # um diretório por módulo; é aqui que vive a lógica de tela
│   │   ├── analytics/  {components, hooks, api.ts, types.ts}
│   │   ├── delivery/   · flash-offers/ · smart-cart/ · credit/
│   │   ├── scheduling/ · daily-menu/ · vip/ · printing/ · orders/
│   ├── lib/
│   │   ├── api-client.ts           # fetch tipado para apps/api (server e client)
│   │   ├── realtime/               # cliente Socket.io, reconexão, fila de eventos
│   │   ├── audio/new-order-alert.ts# Web Audio: alerta persistente até "atender"
│   │   ├── print/                  # drivers: browser (80 mm), ESC/POS (WebUSB/Serial)
│   │   ├── push/ · geo/ · pwa/
│   │   └── format.ts
│   └── components/                 # UI genérica (botões, tabela, gráfico, mapa)
└── next.config.ts
```

Regra de dependência: `app/` importa `features/`; `features/` importa `lib/` e `components/`; **nunca** o contrário, e um `feature` não importa outro (conversam por `packages/contracts`).

### 5.3 `apps/api/src/modules` (mesmo formato de `orders/`: schema → repository → service → routes)

```
modules/
├── (existentes) addresses analytics auth b2b categories deals orders pos products reports stores users
├── delivery/        # deliveries, couriers, offers, PIN, tracking (+ gateway de realtime)
├── flash-offers/    # ofertas relâmpago, claims, fan-out de push por geofence
├── smart-cart/      # receitas, itens canônicos, otimizador de menor custo
├── credit/          # caderneta + ledger
├── scheduling/      # slots, bookings, encomendas
├── daily-menu/      # combos e pratos do dia
├── vip/             # planos, assinatura, webhook do gateway
├── printing/        # print_jobs, ack do caixa
├── push/            # Web Push (VAPID), limpeza de endpoints mortos
└── events/          # store_events (funil)
shared/realtime.ts   # novos eventos: delivery:offered, delivery:location, print:job, offer:new
shared/jobs.ts       # novos jobs: expirar ofertas e convites, renovar VIP, lembretes da caderneta, limpar trilha GPS
```

## 6. Pontos técnicos que não são óbvios

- **Impressão térmica.** Um site não imprime em ESC/POS sozinho. Três caminhos, em ordem de esforço: (1) `window.print()` com CSS de 80 mm (zero instalação, mas abre o diálogo, a menos que o Chrome rode com `--kiosk-printing`); (2) WebUSB / Web Serial mandando bytes ESC/POS direto (impressão silenciosa, só Chrome/Edge desktop, exige pareamento uma vez); (3) agente local (QZ Tray). Recomendo começar por (1) com `--kiosk-printing` e evoluir para (2). `print_jobs` existe para que o job sobreviva a caixa offline e nunca imprima em dobro.
- **Alerta sonoro persistente.** Navegadores só liberam áudio depois de um gesto do usuário: o painel precisa de um botão "Ativar som do caixa" no início do turno. O alerta toca em loop até alguém clicar "atender"; aba em segundo plano tem timers limitados, então o Wake Lock + o próprio push cobrem o caso. É onde o alerta mais falha na prática.
- **PWA.** Cache offline só do *shell* e do catálogo; **pedido nunca é servido de cache**. Push de pedido novo para o lojista e de "chegou" para o cliente. iOS só recebe push com o PWA instalado na tela inicial (iOS 16.4+).
- **Rastreamento.** O entregador envia posição a cada ~5 s só durante a corrida; o servidor repassa pela sala `delivery:<id>` e grava um ponto a cada ~15 s. Mapa com Leaflet + OpenStreetMap evita custo de API de mapas.
- **Carrinho Inteligente.** O custo é soma dos itens mais o frete de cada loja usada. Com as ~8 lojas mais próximas, testar todos os subconjuntos de até 3 lojas (92 combinações) é exato e instantâneo; sem solver. O gargalo real é a qualidade do vínculo `products.canonical_id` (vem do código de barras e de curadoria).
- **Clube VIP.** O desconto vai direto em `order_items.unit_price` (como o Salva-Estoque), e `orders.vip_savings` registra quanto foi. O Pix recorrente depende do gateway escolhido; o schema só guarda fatura e referência.

## 7. Ordem sugerida de entrega

1. **Fundação**: manter o front em React + Vite e usar `packages/contracts` (já existe). Migração para Next.js fica como opção futura, depois do MVP. (O `schema.sql` já inclui 004–013; ao criar uma migração nova, anexe-a lá também.)
2. **Operação da loja** (005): impressão + alerta sonoro + `store_events` → fecha o Dashboard (Conversão) e o que o lojista mais sente no dia a dia.
3. **Ofertas relâmpago** (006): reaproveita estoque e tempo real; entrega valor sem depender de entregador.
4. **Logística** (004): primeiro retirada + frota própria, depois o pool do bairro (envolve cadastro e confiança de gente nova).
5. **Caderneta, encomendas, combos/prato do dia** (008): independentes entre si.
6. **Carrinho Inteligente** (007): precisa do catálogo já classificado por item canônico.
7. **Clube VIP** (009): por último; depende de volume de pedidos e de decisão sobre o gateway.
8. **PWA e push** corre em paralelo desde a etapa 2.

## 8. Decisões tomadas (16/11/2026)

1. **Frontend**: React + Vite + PWA separado da API. A migração para Next.js fica adiada para depois do MVP. `packages/contracts` já existe.
2. **Gateway (Clube VIP)**: webhook idempotente gravando em `vip_invoices`, sem custódia de valores. Adapter `PaymentGatewayProvider` com Asaas (sandbox) como padrão e modo `mock`, escolhido por `VIP_PROVIDER=mock|asaas`.
3. **Caderneta**: só livro-razão e lembrete, sem intermediação. O lojista dá baixa manual. O lembrete vai in-app/push, com link de WhatsApp que leva o Pix copia e cola da chave do próprio lojista.
4. **Logística**: entregador autônomo, com acerto direto com o lojista. A plataforma só registra `courier_fee`, rastreia o GPS e valida o PIN, que é apagado na confirmação da entrega.
5. **Subsídio do VIP e do frete grátis**: custeado pelo lojista por adesão (`vip_merchants`), dentro dos tetos.
6. **LGPD e retenção**:

| Dado | Retenção |
|---|---|
| GPS do entregador | 30 dias (execução de contrato) |
| Localização de alertas | Até a revogação ou exclusão pelo usuário (consentimento) |
| Funil `store_events` | 90 dias, pseudonimizado |
| Pedidos e livro da caderneta | 5 anos (obrigação fiscal/prescrição) |
| PIN de entrega | Apagado na confirmação da entrega |

Related: [04 — Arquitetura e Stack](04-arquitetura-e-stack.md) · [05 — Modelagem de Dados](05-modelagem-de-dados.md) · [07 — Estrutura do Repositório](07-estrutura-do-repositorio.md)
Up: [Índice da documentação](README.md)
