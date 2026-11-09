-- 004 · Logística: Vizinho Flash, pool de entregadores, rastreamento e PIN de entrega.
-- Idempotente (IF NOT EXISTS). Aplicada por `npm run migrate` (apps/api).
--
-- Decisões:
--  * Entregador NÃO é um novo valor de user_role: é um perfil (tabela couriers) de um usuário comum. Assim
--    nada que testa `role = 'MERCHANT'` / `'CUSTOMER'` precisa mudar.
--  * O pedido (orders) continua sendo a venda; a entrega (deliveries) é um processo separado, 1:1 com o pedido.
--  * orders.total_price continua sendo o total das MERCADORIAS (o Dashboard soma essa coluna como faturamento).
--    O que o cliente paga é total_price + delivery_fee.

SET TIME ZONE 'America/Fortaleza';

-- Distância em metros entre dois pontos (esfera; precisão de sobra para raios de 800 m a 10 km).
CREATE OR REPLACE FUNCTION distance_m(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION, lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT earth_distance(ll_to_earth(lat1, lng1), ll_to_earth(lat2, lng2))
$$;

-- Endereço do cliente precisa de coordenadas para o raio do Flash (preenchidas pelo geocoding no cadastro).
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6) CHECK (latitude  BETWEEN  -90 AND  90);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180);

-- Como o pedido chega ao cliente. Pedidos antigos viram PICKUP (retirada), o padrão mais seguro.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment  VARCHAR(10)   NOT NULL DEFAULT 'PICKUP'
  CHECK (fulfillment IN ('PICKUP', 'DELIVERY', 'FLASH'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat NUMERIC(9,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng NUMERIC(9,6);

-- Configuração de entrega de cada loja. Fica fora de users.store_settings (JSONB) porque o Flash precisa
-- ser filtrado/ordenado no banco.
CREATE TABLE IF NOT EXISTS store_delivery_config (
  merchant_id      UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  has_own_fleet    BOOLEAN      NOT NULL DEFAULT FALSE,     -- FALSE = pode chamar o pool de entregadores do bairro
  delivery_enabled BOOLEAN      NOT NULL DEFAULT FALSE,
  delivery_radius_m INTEGER     NOT NULL DEFAULT 3000 CHECK (delivery_radius_m BETWEEN 100 AND 10000),
  delivery_fee     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  flash_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,     -- "Vizinho Flash": itens essenciais num raio curto
  flash_radius_m   INTEGER      NOT NULL DEFAULT 800 CHECK (flash_radius_m BETWEEN 100 AND 1500),
  flash_fee        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (flash_fee >= 0),
  flash_eta_min    SMALLINT     NOT NULL DEFAULT 15 CHECK (flash_eta_min BETWEEN 5 AND 60),
  auto_print       BOOLEAN      NOT NULL DEFAULT TRUE,      -- imprime a comanda ao chegar o pedido (005)
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT flash_inside_delivery CHECK (flash_radius_m <= delivery_radius_m OR NOT delivery_enabled)
);

-- Produtos elegíveis ao Flash ("essenciais de última hora"): o lojista marca quais.
ALTER TABLE products ADD COLUMN IF NOT EXISTS flash_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- ----------------------------------------------------------------------------
-- couriers: motoboys/ciclistas do bairro. Um usuário comum com perfil de entregador.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS couriers (
  user_id       UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle       VARCHAR(8)   NOT NULL CHECK (vehicle IN ('MOTO', 'BIKE', 'FOOT')),
  neighborhood  VARCHAR(80)  NOT NULL,                       -- bairro-base: o pool é "da mesma região"
  city          VARCHAR(80)  NOT NULL,
  status        VARCHAR(9)   NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('OFFLINE', 'AVAILABLE', 'BUSY')),
  approved      BOOLEAN      NOT NULL DEFAULT FALSE,         -- o lojista confia em quem passou por cadastro/aprovação
  last_lat      NUMERIC(9,6),
  last_lng      NUMERIC(9,6),
  last_seen_at  TIMESTAMPTZ,
  rating_avg    NUMERIC(3,2) CHECK (rating_avg BETWEEN 1 AND 5),
  deliveries_done INTEGER    NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- "Quem está disponível e perto desta loja": filtra por status e usa o índice geográfico.
CREATE INDEX IF NOT EXISTS idx_couriers_available_geo ON couriers USING gist (ll_to_earth(last_lat, last_lng))
  WHERE status = 'AVAILABLE' AND approved AND last_lat IS NOT NULL AND last_lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_couriers_area ON couriers (city, neighborhood) WHERE approved;

-- ----------------------------------------------------------------------------
-- deliveries: uma por pedido com entrega (DELIVERY/FLASH).
-- Ciclo: REQUESTED → OFFERED → ACCEPTED → PICKED_UP → DELIVERED   (FAILED / CANCELLED a qualquer momento)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID         NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  merchant_id   UUID         NOT NULL REFERENCES users(id),
  courier_id    UUID         REFERENCES couriers(user_id),           -- NULL até alguém aceitar (ou frota própria sem cadastro)
  status        VARCHAR(10)  NOT NULL DEFAULT 'REQUESTED'
                CHECK (status IN ('REQUESTED', 'OFFERED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED')),
  -- PIN de 4 dígitos: o cliente o vê no app e o entregador o digita para fechar a entrega.
  -- Fica em texto porque o app precisa reexibi-lo; a defesa contra chute é o limite de tentativas abaixo.
  pin_code      CHAR(4)      NOT NULL CHECK (pin_code ~ '^[0-9]{4}$'),
  pin_attempts  SMALLINT     NOT NULL DEFAULT 0 CHECK (pin_attempts BETWEEN 0 AND 5),   -- 5 erros = travada, só o lojista libera
  courier_fee   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (courier_fee >= 0),              -- repasse ao entregador
  pickup_lat    NUMERIC(9,6) NOT NULL,
  pickup_lng    NUMERIC(9,6) NOT NULL,
  dropoff_lat   NUMERIC(9,6) NOT NULL,
  dropoff_lng   NUMERIC(9,6) NOT NULL,
  distance_m    INTEGER      CHECK (distance_m >= 0),
  requested_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  picked_up_at  TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  failure_reason TEXT,
  CONSTRAINT deliveries_courier_when_moving CHECK (
    courier_id IS NOT NULL OR status IN ('REQUESTED', 'OFFERED', 'CANCELLED', 'FAILED')
  )
);
CREATE INDEX IF NOT EXISTS idx_deliveries_merchant ON deliveries (merchant_id, requested_at DESC);
-- "Minhas corridas em andamento" do entregador.
CREATE INDEX IF NOT EXISTS idx_deliveries_courier_active ON deliveries (courier_id) WHERE status IN ('ACCEPTED', 'PICKED_UP');
-- Fila de chamados abertos que o pool enxerga.
CREATE INDEX IF NOT EXISTS idx_deliveries_open ON deliveries (requested_at) WHERE status IN ('REQUESTED', 'OFFERED');

-- Alerta disparado aos entregadores do pool. Vários recebem; só um aceita (ver abaixo).
CREATE TABLE IF NOT EXISTS delivery_offers (
  delivery_id UUID        NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  courier_id  UUID        NOT NULL REFERENCES couriers(user_id) ON DELETE CASCADE,
  status      VARCHAR(8)  NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  distance_m  INTEGER,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (delivery_id, courier_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_offers_courier ON delivery_offers (courier_id, sent_at DESC) WHERE status = 'PENDING';

-- Trilha GPS para o mapa de rastreamento. Cresce rápido: guarde só o que o cliente precisa ver e apague
-- depois de alguns dias (job). O ponto mais recente também fica em couriers.last_lat/last_lng.
CREATE TABLE IF NOT EXISTS courier_location_log (
  id          BIGSERIAL    PRIMARY KEY,
  delivery_id UUID         NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  lat         NUMERIC(9,6) NOT NULL,
  lng         NUMERIC(9,6) NOT NULL,
  recorded_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_location_log_delivery ON courier_location_log (delivery_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_log_brin     ON courier_location_log USING brin (recorded_at);
