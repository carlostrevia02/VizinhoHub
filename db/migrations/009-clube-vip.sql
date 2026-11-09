-- 009 · Clube de Vantagens (Selo Vizinho VIP): assinatura mensal, frete grátis e desconto progressivo.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- O plano é da PLATAFORMA (o assinante vale em toda a rede) e o comerciante adere (vip_merchants). Quem
-- banca o frete grátis e o desconto é DECISÃO DE NEGÓCIO em aberto — por isso a adesão guarda os dois
-- percentuais por loja, em vez de fixar a regra no código.

SET TIME ZONE 'America/Fortaleza';

CREATE TABLE IF NOT EXISTS vip_plans (
  id                      SERIAL        PRIMARY KEY,
  code                    VARCHAR(20)   NOT NULL UNIQUE,
  name                    VARCHAR(60)   NOT NULL,
  price_monthly           NUMERIC(10,2) NOT NULL CHECK (price_monthly >= 0),
  free_delivery           BOOLEAN       NOT NULL DEFAULT TRUE,
  free_delivery_min_order NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (free_delivery_min_order >= 0),
  active                  BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Desconto progressivo: quanto mais meses de assinatura, maior o desconto.
CREATE TABLE IF NOT EXISTS vip_tiers (
  plan_id      INTEGER      NOT NULL REFERENCES vip_plans(id) ON DELETE CASCADE,
  min_months   SMALLINT     NOT NULL CHECK (min_months >= 1),
  discount_pct NUMERIC(4,1) NOT NULL CHECK (discount_pct BETWEEN 0 AND 30),
  PRIMARY KEY (plan_id, min_months)
);

CREATE TABLE IF NOT EXISTS vip_subscriptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id              INTEGER     NOT NULL REFERENCES vip_plans(id),
  status               VARCHAR(9)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN     NOT NULL DEFAULT FALSE,
  cancelled_at         TIMESTAMPTZ
);
-- Uma assinatura vigente por usuário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vip_one_active ON vip_subscriptions (user_id) WHERE status IN ('ACTIVE', 'PAST_DUE');
CREATE INDEX IF NOT EXISTS idx_vip_renewal ON vip_subscriptions (current_period_end) WHERE status IN ('ACTIVE', 'PAST_DUE');

-- Cobrança de cada ciclo (Pix/cartão pelo gateway). O job de renovação cria a fatura; o webhook do gateway a paga.
CREATE TABLE IF NOT EXISTS vip_invoices (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID          NOT NULL REFERENCES vip_subscriptions(id) ON DELETE CASCADE,
  period_start    DATE          NOT NULL,
  period_end      DATE          NOT NULL,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status          VARCHAR(7)    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'VOID')),
  provider        VARCHAR(20),
  provider_ref    TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_start),                       -- job reexecutado não duplica a fatura
  CHECK (period_end > period_start)
);
-- O webhook do gateway chega com a referência dele; precisa achar a fatura rápido (e uma vez só).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vip_invoices_provider_ref ON vip_invoices (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- Lojas que aceitam o Selo VIP, com o quanto cada uma concede.
CREATE TABLE IF NOT EXISTS vip_merchants (
  merchant_id        UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discount_enabled   BOOLEAN      NOT NULL DEFAULT TRUE,
  discount_cap_pct   NUMERIC(4,1) NOT NULL DEFAULT 10 CHECK (discount_cap_pct BETWEEN 0 AND 30),   -- teto que a loja aceita bancar
  funds_free_delivery BOOLEAN     NOT NULL DEFAULT FALSE,                                          -- FALSE = a plataforma banca o frete
  enrolled_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Quanto do pedido veio de benefício VIP (relatório "quanto o clube economizou" e "quanto a loja bancou").
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vip_savings NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (vip_savings >= 0);

-- Desconto VIP vigente do usuário hoje: a maior faixa cujo tempo mínimo de assinatura ele já cumpriu.
-- Meses de casa = meses completos desde started_at, +1 (o 1º mês já conta). 0 se não for assinante.
CREATE OR REPLACE FUNCTION vip_discount_pct(p_user UUID) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT t.discount_pct
      FROM vip_subscriptions s
      JOIN vip_tiers t ON t.plan_id = s.plan_id
       AND t.min_months <= (extract(year  FROM age(current_date, s.started_at::date)) * 12
                          + extract(month FROM age(current_date, s.started_at::date)))::int + 1
     WHERE s.user_id = p_user AND s.status = 'ACTIVE' AND s.current_period_end > now()
     ORDER BY t.min_months DESC
     LIMIT 1), 0)
$$;

-- Plano inicial (valores de partida; ajuste conforme a decisão de negócio).
INSERT INTO vip_plans (code, name, price_monthly, free_delivery, free_delivery_min_order)
VALUES ('vizinho-vip', 'Vizinho VIP', 14.90, TRUE, 30.00)
ON CONFLICT (code) DO NOTHING;
INSERT INTO vip_tiers (plan_id, min_months, discount_pct)
SELECT p.id, v.m, v.d FROM vip_plans p, (VALUES (1, 2.0), (3, 4.0), (6, 6.0), (12, 8.0)) AS v(m, d)
 WHERE p.code = 'vizinho-vip'
ON CONFLICT (plan_id, min_months) DO NOTHING;
