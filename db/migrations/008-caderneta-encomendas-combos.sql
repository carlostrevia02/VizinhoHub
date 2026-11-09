-- 008 · Caderneta Digital (fiado), Encomendas/Agendamento e Vitrine de Combos / Prato do Dia.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).

SET TIME ZONE 'America/Fortaleza';

-- ============================================================================
-- Caderneta Digital (Fiado do Bairro)
-- Dinheiro exige livro-razão: credit_ledger só recebe INSERT; o saldo em credit_accounts é um acelerador
-- que SEMPRE muda na mesma transação do lançamento. Conferir: balance = SUM(amount) do ledger.
-- Convenção: balance = quanto o cliente DEVE. Compra a fiado (CHARGE) soma; pagamento (PAYMENT) subtrai.
--
-- Cobrança atômica contra o limite (sem SELECT prévio, sem corrida):
--   UPDATE credit_accounts SET balance = balance + $v
--    WHERE id = $a AND status = 'ACTIVE' AND balance + $v <= credit_limit RETURNING balance
-- O limite NÃO é um CHECK da tabela de propósito: o lojista pode baixar o limite abaixo da dívida atual
-- (o cliente continua devendo, só não consegue comprar mais).
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_accounts (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_limit     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  balance          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status           VARCHAR(9)    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  settlement_day   SMALLINT      CHECK (settlement_day BETWEEN 1 AND 28),   -- dia combinado do acerto
  last_reminder_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, customer_id),
  CHECK (merchant_id <> customer_id)
);
-- "Quem está devendo": a tela de cobrança e o job de lembretes.
CREATE INDEX IF NOT EXISTS idx_credit_accounts_owing    ON credit_accounts (merchant_id, balance DESC) WHERE balance > 0;
CREATE INDEX IF NOT EXISTS idx_credit_accounts_customer ON credit_accounts (customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_accounts_remind   ON credit_accounts (settlement_day, last_reminder_at) WHERE balance > 0 AND status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS credit_ledger (
  id            BIGSERIAL     PRIMARY KEY,
  account_id    UUID          NOT NULL REFERENCES credit_accounts(id),
  kind          VARCHAR(10)   NOT NULL CHECK (kind IN ('CHARGE', 'PAYMENT', 'ADJUSTMENT')),
  amount        NUMERIC(10,2) NOT NULL CHECK (amount <> 0),                 -- com sinal: CHARGE > 0, PAYMENT < 0
  balance_after NUMERIC(10,2) NOT NULL CHECK (balance_after >= 0),
  order_id      UUID          REFERENCES orders(id),
  payment_method VARCHAR(20),                                              -- como o cliente acertou (PIX, dinheiro…)
  note          TEXT,
  created_by    UUID          REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT credit_ledger_sign CHECK (
    (kind = 'CHARGE' AND amount > 0) OR (kind = 'PAYMENT' AND amount < 0) OR kind = 'ADJUSTMENT'
  )
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_account ON credit_ledger (account_id, created_at DESC);
-- Um pedido só pode ser lançado uma vez na caderneta (retry de rede não cobra em dobro).
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_order_charge ON credit_ledger (order_id) WHERE kind = 'CHARGE' AND order_id IS NOT NULL;

-- ============================================================================
-- Encomendas e Agendamento
-- Pedido agendado = pedido comum com scheduled_for. Produtos "sob medida" têm antecedência mínima.
-- Capacidade por faixa de horário (a padaria só faz 6 bolos por tarde): pickup_slots + slot_bookings.
-- Reserva de vaga atômica (mesmo princípio do estoque):
--   INSERT INTO slot_bookings (slot_id, slot_date, booked) VALUES ($s, $d, 1)
--   ON CONFLICT (slot_id, slot_date) DO UPDATE SET booked = slot_bookings.booked + 1
--     WHERE slot_bookings.booked < (SELECT capacity FROM pickup_slots WHERE id = $s)
--   RETURNING booked          → 0 linhas = faixa lotada
-- ============================================================================
CREATE TABLE IF NOT EXISTS pickup_slots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday     SMALLINT    NOT NULL CHECK (weekday BETWEEN 0 AND 6),        -- 0 = domingo
  starts_at   TIME        NOT NULL,
  ends_at     TIME        NOT NULL,
  capacity    INTEGER     NOT NULL CHECK (capacity > 0),
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  CHECK (ends_at > starts_at),
  UNIQUE (merchant_id, weekday, starts_at)
);

CREATE TABLE IF NOT EXISTS slot_bookings (
  slot_id   UUID     NOT NULL REFERENCES pickup_slots(id) ON DELETE CASCADE,
  slot_date DATE     NOT NULL,
  booked    INTEGER  NOT NULL DEFAULT 0 CHECK (booked >= 0),
  PRIMARY KEY (slot_id, slot_date)
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS slot_id        UUID REFERENCES pickup_slots(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0);   -- sinal
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS customization TEXT;                                                        -- "escrever Parabéns, Ana"
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_hours INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_hours >= 0);     -- 0 = pronta entrega
-- "Encomendas do dia/semana" no Kanban e na agenda.
CREATE INDEX IF NOT EXISTS idx_orders_scheduled ON orders (merchant_id, scheduled_for) WHERE scheduled_for IS NOT NULL;

-- ============================================================================
-- Vitrine de Combos e Pratos do Dia
-- Combo = um produto (kind = 'COMBO') composto por outros; vender um combo baixa o estoque dos COMPONENTES
-- (movimentos COMBO_COMPONENT no livro de estoque). Prato do dia = linha em daily_menu, com liga/desliga e
-- contador próprio que "zera" sozinho porque a chave é (produto, data): amanhã é outra linha.
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS kind VARCHAR(14) NOT NULL DEFAULT 'ITEM' CHECK (kind IN ('ITEM', 'COMBO', 'DAILY_SPECIAL'));

CREATE TABLE IF NOT EXISTS combo_items (
  combo_id     UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id UUID    NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (combo_id, component_id),
  CHECK (combo_id <> component_id)
);
CREATE INDEX IF NOT EXISTS idx_combo_items_component ON combo_items (component_id);

CREATE TABLE IF NOT EXISTS daily_menu (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id    UUID        NOT NULL,
  menu_date     DATE        NOT NULL DEFAULT current_date,
  is_on         BOOLEAN     NOT NULL DEFAULT TRUE,                       -- o toggle ON/OFF do lojista
  qty_total     INTEGER     NOT NULL CHECK (qty_total >= 0),
  qty_available INTEGER     NOT NULL CHECK (qty_available >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, menu_date),
  CONSTRAINT daily_menu_qty   CHECK (qty_available <= qty_total),
  CONSTRAINT daily_menu_owner FOREIGN KEY (product_id, merchant_id) REFERENCES products (id, user_id)
);
-- Vitrine "hoje": itens ligados com sobra.
CREATE INDEX IF NOT EXISTS idx_daily_menu_today ON daily_menu (merchant_id, menu_date) WHERE is_on AND qty_available > 0;
-- Venda atômica (esgota → some da vitrine sozinho):
--   UPDATE daily_menu SET qty_available = qty_available - $q, updated_at = now()
--    WHERE product_id = $p AND menu_date = current_date AND is_on AND qty_available >= $q
