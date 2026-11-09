-- 005 · Operação da loja: funil (conversão), fila de impressão, push do PWA e livro de movimentação de estoque.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).

SET TIME ZONE 'America/Fortaleza';

-- ----------------------------------------------------------------------------
-- store_events: eventos de navegação da vitrine. Sem isto o Dashboard não tem como calcular "Conversão"
-- (pedidos ÷ visitas) — orders só enxerga quem já comprou.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_events (
  id          BIGSERIAL    PRIMARY KEY,
  merchant_id UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  UUID         NOT NULL,                        -- gerado no navegador; vale também para visitante anônimo
  user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
  type        VARCHAR(14)  NOT NULL CHECK (type IN ('STORE_VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_START')),
  product_id  UUID         REFERENCES products(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Mesmo formato dos filtros do Dashboard: loja + janela de tempo.
CREATE INDEX IF NOT EXISTS idx_store_events_merchant_time ON store_events (merchant_id, created_at) INCLUDE (type, session_id);
CREATE INDEX IF NOT EXISTS idx_store_events_brin          ON store_events USING brin (created_at);
-- Conversão = pedidos online ÷ sessões distintas com STORE_VIEW no período. Quando passar de alguns milhões
-- de linhas, agregue por dia (tabela de rollup) e particione esta por mês (PARTITION BY RANGE (created_at)).

-- ----------------------------------------------------------------------------
-- print_jobs: fila de impressão. O pedido grava o job na MESMA transação em que é criado; o caixa (navegador
-- aberto na loja) recebe por WebSocket e confirma. Se o caixa estiver offline, o job espera em QUEUED
-- e é entregue quando ele reconectar — o pedido nunca "some" da impressora.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_jobs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind        VARCHAR(12)  NOT NULL DEFAULT 'TICKET' CHECK (kind IN ('TICKET', 'KITCHEN', 'RECEIPT')),
  copy_no     SMALLINT     NOT NULL DEFAULT 1,              -- reimpressão manual = copy_no + 1
  status      VARCHAR(8)   NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'PRINTED', 'FAILED')),
  attempts    SMALLINT     NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  printed_at  TIMESTAMPTZ,
  UNIQUE (order_id, kind, copy_no)                           -- evita imprimir em dobro se o evento chegar duas vezes
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_pending ON print_jobs (merchant_id, created_at) WHERE status IN ('QUEUED', 'SENT');

-- ----------------------------------------------------------------------------
-- push_subscriptions: Web Push (PWA). Um usuário pode ter vários aparelhos.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  app        VARCHAR(10) NOT NULL DEFAULT 'CUSTOMER' CHECK (app IN ('CUSTOMER', 'MERCHANT', 'COURIER')),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ                                     -- endpoint que devolve 404/410 é apagado pelo job de push
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id, app);

-- ----------------------------------------------------------------------------
-- stock_movements: livro-razão do estoque (só insere). products.stock_qty continua sendo o saldo rápido;
-- este livro explica POR QUE o saldo mudou (venda, cancelamento, oferta relâmpago, ajuste, perda).
-- Serve para auditar divergência de estoque e para "perdas por validade" nos relatórios.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id          BIGSERIAL   PRIMARY KEY,
  product_id  UUID        NOT NULL REFERENCES products(id),
  merchant_id UUID        NOT NULL REFERENCES users(id),
  delta       INTEGER     NOT NULL CHECK (delta <> 0),
  stock_after INTEGER     NOT NULL CHECK (stock_after >= 0),
  reason      VARCHAR(16) NOT NULL CHECK (reason IN ('SALE', 'CANCEL_RETURN', 'FLASH_SALE', 'MANUAL_ADJUST',
                                                     'EXPIRED_WRITEOFF', 'B2B_TRANSFER', 'PURCHASE', 'COMBO_COMPONENT')),
  order_id    UUID        REFERENCES orders(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_order   ON stock_movements (order_id) WHERE order_id IS NOT NULL;

-- Bloqueio otimista para EDIÇÃO feita pelo lojista (duas abas editando o mesmo produto):
--   UPDATE products SET price = $1, version = version + 1 WHERE id = $2 AND version = $3   → 0 linhas = conflito (HTTP 409)
-- A baixa de estoque das vendas NÃO usa version: ela usa `stock_qty >= q` atômico, para não brigar com edições.
ALTER TABLE products ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
