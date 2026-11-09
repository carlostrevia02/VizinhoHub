-- 006 · Radar de Ofertas Relâmpago ("Tá Quentinho") com proteção contra venda duplicada.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- Relação com o Salva-Estoque (já existente): ele dá desconto AUTOMÁTICO por validade (50%/30%).
-- A oferta relâmpago é uma ação DELIBERADA do lojista (ou sugerida pelo sistema): preço agressivo,
-- quantidade limitada, prazo curto, alcance geográfico e push. Uma pode nascer da outra (reason = 'EXPIRING').
--
-- PROTEÇÃO CONTRA RACE CONDITION — a oferta tem seu PRÓPRIO saldo (qty_available) e a compra baixa os dois
-- saldos (oferta e produto) na mesma transação, SEMPRE nesta ordem (evita deadlock):
--   1) UPDATE flash_offers SET qty_available = qty_available - $q
--        WHERE id = $o AND status = 'ACTIVE' AND qty_available >= $q AND now() BETWEEN starts_at AND ends_at
--      → 0 linhas = esgotou/expirou (o banco decide, sem ler-e-gravar)
--   2) INSERT INTO flash_offer_claims ... ON CONFLICT DO UPDATE ... WHERE qty + $q <= limite   (limite por cliente)
--   3) UPDATE products SET stock_qty = stock_qty - $q WHERE id = $p AND stock_qty >= $q         (CHECK stock_qty >= 0)
-- Qualquer falha dá ROLLBACK e as três baixas voltam juntas. SELECT ... FOR UPDATE só é necessário se uma
-- regra precisar LER antes de decidir; aqui o UPDATE condicional já é o lock (a linha fica travada até o COMMIT).

SET TIME ZONE 'America/Fortaleza';

-- Permite a FK composta "este produto pertence a este lojista" (impede oferta de A usando produto de B).
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_id_owner ON products (id, user_id);

CREATE TABLE IF NOT EXISTS flash_offers (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID          NOT NULL REFERENCES users(id),
  product_id      UUID          NOT NULL,
  reason          VARCHAR(8)    NOT NULL DEFAULT 'MANUAL' CHECK (reason IN ('EXPIRING', 'OVERSTOCK', 'MANUAL')),
  original_price  NUMERIC(10,2) NOT NULL CHECK (original_price > 0),
  offer_price     NUMERIC(10,2) NOT NULL CHECK (offer_price > 0),
  qty_total       INTEGER       NOT NULL CHECK (qty_total > 0),
  qty_available   INTEGER       NOT NULL CHECK (qty_available >= 0),
  max_per_customer INTEGER      NOT NULL DEFAULT 2 CHECK (max_per_customer >= 1),
  radius_m        INTEGER       NOT NULL DEFAULT 2000 CHECK (radius_m BETWEEN 100 AND 10000),
  starts_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ   NOT NULL,
  status          VARCHAR(9)    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'SOLD_OUT', 'ENDED', 'CANCELLED')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT flash_offers_discount   CHECK (offer_price < original_price),
  CONSTRAINT flash_offers_qty        CHECK (qty_available <= qty_total),
  CONSTRAINT flash_offers_window     CHECK (ends_at > starts_at),
  CONSTRAINT flash_offers_owner      FOREIGN KEY (product_id, merchant_id) REFERENCES products (id, user_id)
);
-- Radar: ofertas vigentes (o filtro geográfico junta com o índice gist de users).
CREATE INDEX IF NOT EXISTS idx_flash_offers_live     ON flash_offers (ends_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_flash_offers_merchant ON flash_offers (merchant_id, status, ends_at DESC);
CREATE INDEX IF NOT EXISTS idx_flash_offers_product  ON flash_offers (product_id) WHERE status IN ('SCHEDULED', 'ACTIVE');
-- No máximo uma oferta viva por produto: duas ofertas sobre o mesmo estoque confundiriam o cliente e o saldo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_flash_offers_one_live ON flash_offers (product_id) WHERE status IN ('SCHEDULED', 'ACTIVE');

-- Quanto cada cliente já levou de cada oferta (limite por pessoa, também atômico).
CREATE TABLE IF NOT EXISTS flash_offer_claims (
  offer_id    UUID        NOT NULL REFERENCES flash_offers(id) ON DELETE CASCADE,
  customer_id UUID        NOT NULL REFERENCES users(id),
  qty         INTEGER     NOT NULL CHECK (qty >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, customer_id)
);

-- A linha do pedido guarda de qual oferta veio (devolução ao cancelar e relatório de conversão).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS flash_offer_id UUID REFERENCES flash_offers(id);
CREATE INDEX IF NOT EXISTS idx_order_items_flash ON order_items (flash_offer_id) WHERE flash_offer_id IS NOT NULL;

-- Onde o cliente quer ser avisado ("perto de casa", "perto do trabalho").
CREATE TABLE IF NOT EXISTS offer_alert_subscriptions (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      VARCHAR(40)  NOT NULL DEFAULT 'Casa',
  latitude   NUMERIC(9,6) NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
  longitude  NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m   INTEGER      NOT NULL DEFAULT 1500 CHECK (radius_m BETWEEN 200 AND 5000),
  category_ids INTEGER[],                                    -- NULL = todas as categorias
  quiet_from TIME,                                           -- não perturbar (ex.: 22:00–07:00)
  quiet_to   TIME,
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_subs_geo  ON offer_alert_subscriptions USING gist (ll_to_earth(latitude, longitude)) WHERE active;
CREATE INDEX IF NOT EXISTS idx_alert_subs_user ON offer_alert_subscriptions (user_id);

-- Dedupe do push: a mesma oferta nunca notifica o mesmo usuário duas vezes.
CREATE TABLE IF NOT EXISTS offer_notifications (
  offer_id UUID        NOT NULL REFERENCES flash_offers(id) ON DELETE CASCADE,
  user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, user_id)
);

-- Feed do Radar já com preço, loja e distância: a API só passa (lat, lng) do cliente.
-- Uso: SELECT * FROM v_flash_offers_live WHERE distance_m(store_lat, store_lng, $lat, $lng) <= radius_m ORDER BY ends_at;
CREATE OR REPLACE VIEW v_flash_offers_live AS
SELECT o.id, o.merchant_id, o.product_id, o.reason, o.original_price, o.offer_price,
       round((1 - o.offer_price / o.original_price) * 100)::INTEGER AS discount_pct,
       o.qty_available, o.max_per_customer, o.radius_m, o.ends_at,
       p.name AS product_name, p.image, p.unit, p.category_id,
       u.store_name, u.neighborhood, u.latitude::float8 AS store_lat, u.longitude::float8 AS store_lng
  FROM flash_offers o
  JOIN products p ON p.id = o.product_id AND p.active
  JOIN users    u ON u.id = o.merchant_id
 WHERE o.status = 'ACTIVE' AND o.qty_available > 0 AND now() >= o.starts_at AND now() < o.ends_at
   AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL;
