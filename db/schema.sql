-- ============================================================================
-- VizinhoHub — esquema PostgreSQL 16
-- Aplicado automaticamente na 1ª subida do container (ver docker-compose.yml).
-- Fonte única da verdade do banco: qualquer mudança vira uma nova migração.
-- ============================================================================

-- Extensões que acompanham a imagem oficial do Postgres (contrib).
CREATE EXTENSION IF NOT EXISTS citext;       -- e-mail sem diferenciar maiúsculas
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- busca por nome (ILIKE '%leite%') com índice
CREATE EXTENSION IF NOT EXISTS unaccent;     -- "acucar" encontra "Açúcar"
CREATE EXTENSION IF NOT EXISTS cube;         -- pré-requisito do earthdistance
CREATE EXTENSION IF NOT EXISTS earthdistance; -- distância entre mercadinhos (lat/lng)

-- "Hoje" é sempre o dia em Fortaleza, senão a validade vira às 21h (UTC-3).
SET TIME ZONE 'America/Fortaleza';

-- ----------------------------------------------------------------------------
-- Tipos
-- ----------------------------------------------------------------------------
CREATE TYPE user_role     AS ENUM ('MERCHANT', 'CUSTOMER');
CREATE TYPE order_status  AS ENUM ('PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED', 'CANCELLED');
CREATE TYPE order_channel AS ENUM ('ONLINE', 'POS');   -- POS = venda de balcão (Modo PDV)

-- ----------------------------------------------------------------------------
-- users
-- Comerciantes carregam os dados da loja (bairro/coordenadas) para a Rede B2B.
-- Identidade: password_hash (login próprio) OU firebase_uid (Firebase Auth, já
-- usado no frontend). Pelo menos um dos dois precisa existir.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  email         CITEXT       NOT NULL UNIQUE,
  password_hash TEXT,
  firebase_uid  TEXT         UNIQUE,
  role          user_role    NOT NULL DEFAULT 'CUSTOMER',
  -- dados da loja (obrigatórios só para MERCHANT)
  store_name    VARCHAR(120),
  neighborhood  VARCHAR(80),
  city          VARCHAR(80),
  state         CHAR(2)      DEFAULT 'CE',
  latitude      NUMERIC(9,6) CHECK (latitude  BETWEEN  -90 AND  90),
  longitude     NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  phone         VARCHAR(30),                         -- WhatsApp (cliente e loja)
  -- Config. da loja (endereço, horários, entrega, pagamentos); validada pela API, com padrões quando vazio.
  store_settings JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT users_has_credential CHECK (password_hash IS NOT NULL OR firebase_uid IS NOT NULL),
  CONSTRAINT users_merchant_has_store CHECK (
    role <> 'MERCHANT' OR (store_name IS NOT NULL AND neighborhood IS NOT NULL AND city IS NOT NULL)
  ),
  -- permite a FK composta "este id é um MERCHANT" usada em products/orders
  CONSTRAINT users_id_role_key UNIQUE (id, role)
);

-- Rede B2B: "mercadinhos do mesmo bairro" e "os mais próximos".
CREATE INDEX idx_users_merchant_area ON users (city, neighborhood) WHERE role = 'MERCHANT';
CREATE INDEX idx_users_merchant_geo  ON users USING gist (ll_to_earth(latitude, longitude))
  WHERE role = 'MERCHANT' AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- ----------------------------------------------------------------------------
-- addresses: endereços de entrega salvos pelo usuário (Minha conta → Endereços)
-- ----------------------------------------------------------------------------
CREATE TABLE addresses (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        VARCHAR(40)  NOT NULL,               -- "Casa", "Trabalho"
  street       VARCHAR(160) NOT NULL,               -- "Rua das Flores, 120"
  neighborhood VARCHAR(80)  NOT NULL,
  city         VARCHAR(80)  NOT NULL,
  state        CHAR(2)      NOT NULL DEFAULT 'CE',
  zip          VARCHAR(9),
  is_primary   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_user ON addresses (user_id);
-- No máximo um endereço principal por usuário.
CREATE UNIQUE INDEX idx_addresses_one_primary ON addresses (user_id) WHERE is_primary;

-- ----------------------------------------------------------------------------
-- categories
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
  id   SERIAL      PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

-- ----------------------------------------------------------------------------
-- products
-- ----------------------------------------------------------------------------
CREATE TABLE products (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID          NOT NULL,                       -- dono (MERCHANT)
  category_id  INTEGER       NOT NULL REFERENCES categories(id),
  name         VARCHAR(160)  NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock_qty    INTEGER       NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),  -- nunca negativo, nem sob concorrência
  unit         VARCHAR(20)   NOT NULL DEFAULT 'Unidade',
  image        VARCHAR(255),                                             -- nome do arquivo em apps/web/public/img

  -- Inovação 1 · Salva-Estoque (anti-desperdício)
  expiration_date    DATE,
  is_clearance       BOOLEAN NOT NULL DEFAULT FALSE,         -- mantido por refresh_clearance()

  -- Inovação 2 · Rede Anti-Ruptura B2B
  allow_b2b_sharing  BOOLEAN NOT NULL DEFAULT FALSE,
  barcode            VARCHAR(14),                            -- EAN/GTIN: chave para achar "o mesmo item" em outro mercadinho
  b2b_reserve_qty    INTEGER NOT NULL DEFAULT 0 CHECK (b2b_reserve_qty >= 0), -- unidades que a loja NÃO oferece à rede

  active       BOOLEAN       NOT NULL DEFAULT TRUE,          -- soft delete
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- só comerciantes têm produtos (coluna gerada + FK composta, sem trigger)
  owner_role   user_role     GENERATED ALWAYS AS ('MERCHANT') STORED,
  CONSTRAINT products_owner_is_merchant FOREIGN KEY (user_id, owner_role) REFERENCES users (id, role)
);

CREATE INDEX idx_products_owner     ON products (user_id)     WHERE active;
CREATE INDEX idx_products_category  ON products (category_id) WHERE active;
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops) WHERE active;

-- Salva-Estoque: varredura por validade só olha o que ainda tem estoque.
-- (current_date não pode entrar em índice parcial; a janela é aplicada na query.)
CREATE INDEX idx_products_expiration ON products (expiration_date)
  WHERE active AND stock_qty > 0 AND expiration_date IS NOT NULL;
-- Vitrine "Salva-Estoque": ofertas vigentes de uma loja.
CREATE INDEX idx_products_clearance  ON products (user_id, expiration_date) WHERE active AND is_clearance;

-- Rede B2B: procurar o mesmo código de barras entre quem compartilha.
CREATE INDEX idx_products_b2b ON products (barcode, user_id)
  WHERE active AND allow_b2b_sharing AND barcode IS NOT NULL;

-- ----------------------------------------------------------------------------
-- orders / order_items
-- customer_id é NULL apenas em venda de balcão (channel = 'POS').
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID          REFERENCES users(id),
  merchant_id  UUID          NOT NULL,
  channel      order_channel NOT NULL DEFAULT 'ONLINE',
  total_price  NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
  status       order_status  NOT NULL DEFAULT 'PENDING',
  -- dados informados no checkout
  contact_name    VARCHAR(120),
  phone           VARCHAR(30),
  delivery_method VARCHAR(60),
  delivery_address TEXT,
  payment_method  VARCHAR(30),
  notes           TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  merchant_role user_role    GENERATED ALWAYS AS ('MERCHANT') STORED,
  CONSTRAINT orders_merchant_is_merchant FOREIGN KEY (merchant_id, merchant_role) REFERENCES users (id, role),
  CONSTRAINT orders_online_has_customer  CHECK (channel = 'POS' OR customer_id IS NOT NULL)
);

-- Kanban do comerciante: "pedidos da minha loja, por status, mais recentes primeiro".
CREATE INDEX idx_orders_merchant_board ON orders (merchant_id, status, created_at DESC);
-- "Meus pedidos" do cliente.
CREATE INDEX idx_orders_customer       ON orders (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;

CREATE TABLE order_items (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID          NOT NULL REFERENCES products(id),
  quantity   INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),   -- preço efetivo no momento da compra (já com desconto)
  UNIQUE (order_id, product_id)
);
CREATE INDEX idx_order_items_product ON order_items (product_id);

-- ============================================================================
-- Regras de negócio no banco (fonte única, usadas pela API e pelas views)
-- ============================================================================

-- Desconto dinâmico do Salva-Estoque, em %: quanto mais perto de vencer, maior.
--   vence hoje/amanhã → 50% · em até 3 dias → 30% · senão 0. Vencido → 0 (não é vendável).
CREATE FUNCTION clearance_discount_pct(expiration DATE) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN expiration IS NULL OR expiration < current_date THEN 0
    WHEN expiration <= current_date + 1 THEN 50
    WHEN expiration <= current_date + 3 THEN 30
    ELSE 0
  END
$$;

-- Preço que o cliente paga de fato.
CREATE FUNCTION product_effective_price(price NUMERIC, clearance BOOLEAN, expiration DATE) RETURNS NUMERIC(10,2)
LANGUAGE sql STABLE AS $$
  SELECT round(price * (100 - CASE WHEN clearance THEN clearance_discount_pct(expiration) ELSE 0 END) / 100.0, 2)::NUMERIC(10,2)
$$;

-- Liga/desliga is_clearance conforme a validade. Rodar de hora em hora (job da API)
-- e logo depois de cadastrar/editar produtos. Retorna quantos produtos mudaram.
CREATE FUNCTION refresh_clearance(window_days INTEGER DEFAULT 3) RETURNS INTEGER
LANGUAGE sql AS $$
  WITH changed AS (
    UPDATE products
       SET is_clearance = (expiration_date IS NOT NULL
                           AND expiration_date >= current_date
                           AND expiration_date <= current_date + window_days)
     WHERE active
       AND is_clearance IS DISTINCT FROM (expiration_date IS NOT NULL
                           AND expiration_date >= current_date
                           AND expiration_date <= current_date + window_days)
    RETURNING 1
  )
  SELECT count(*)::INTEGER FROM changed
$$;

-- ============================================================================
-- Views de leitura
-- ============================================================================

-- Vitrine pública: só o que pode ser vendido hoje (ativo e não vencido), já com o preço final.
CREATE VIEW v_storefront_products AS
SELECT p.id, p.user_id AS merchant_id, u.store_name, u.neighborhood, u.city,
       p.category_id, p.name, p.description, p.price, p.stock_qty, p.unit, p.image,
       p.expiration_date, p.is_clearance,
       CASE WHEN p.is_clearance THEN clearance_discount_pct(p.expiration_date) ELSE 0 END AS discount_pct,
       product_effective_price(p.price, p.is_clearance, p.expiration_date)                AS effective_price
  FROM products p
  JOIN users u ON u.id = p.user_id
 WHERE p.active
   AND (p.expiration_date IS NULL OR p.expiration_date >= current_date);

-- Rede B2B: excedente que cada loja oferece à vizinhança (estoque acima da reserva própria).
CREATE VIEW v_b2b_surplus AS
SELECT p.id AS product_id, p.barcode, p.name, p.user_id AS merchant_id,
       u.store_name, u.neighborhood, u.city, u.latitude, u.longitude,
       p.stock_qty - p.b2b_reserve_qty AS surplus_qty,
       p.price
  FROM products p
  JOIN users u ON u.id = p.user_id
 WHERE p.active
   AND p.allow_b2b_sharing
   AND p.barcode IS NOT NULL
   AND p.stock_qty > p.b2b_reserve_qty
   AND (p.expiration_date IS NULL OR p.expiration_date >= current_date);

-- ============================================================================
-- Inovação 3 · Ofertas do Bairro
-- Um job (a cada hora) lê encartes/sites dos supermercados de Fortaleza, um modelo de
-- linguagem extrai as promoções e a vitrine mostra "o leite está em oferta no São Luiz".
-- O cliente reserva a oferta num cupom e retira no caixa da própria rede.
-- ============================================================================

CREATE TYPE coupon_status AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED');

-- Redes monitoradas (dado de referência, vale também em produção).
CREATE TABLE retail_chains (
  id     SERIAL      PRIMARY KEY,
  slug   VARCHAR(40) NOT NULL UNIQUE,
  name   VARCHAR(80) NOT NULL UNIQUE,
  kind   VARCHAR(12) NOT NULL CHECK (kind IN ('RETAIL', 'WHOLESALE')),   -- WHOLESALE = atacarejo ("a partir de N un.")
  active BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO retail_chains (slug, name, kind) VALUES
  ('assai',        'Assaí Atacadista',            'WHOLESALE'),
  ('atacadao',     'Atacadão',                    'WHOLESALE'),
  ('frangolandia', 'Frangolândia Supermercados',  'RETAIL'),
  ('popular',      'Popular Atacadista',          'WHOLESALE'),
  ('sao-luiz',     'Mercadinhos São Luiz',        'RETAIL'),
  ('cometa',       'Supermercado Cometa',         'RETAIL'),
  ('pinheiro',     'Supermercado Pinheiro',       'RETAIL'),
  ('lagoa',        'Super Lagoa',                 'RETAIL'),
  ('centerbox',    'Centerbox Supermercados',     'RETAIL'),
  ('guara',        'Supermercado Guará',          'RETAIL'),
  ('pao-de-acucar','Pão de Açúcar',               'RETAIL'),
  ('do-povo',      'Super Do Povo',               'RETAIL'),
  ('mega',         'Mega Atacadista',             'WHOLESALE'),
  ('telefrango',   'Super Telefrango',            'RETAIL'),
  ('carnauba',     'Carnaúba Supermercados',      'RETAIL'),
  ('baratao',      'Super Baratão',               'RETAIL'),
  ('mezael',       'Supermercado Mezael',         'RETAIL'),
  ('araripe',      'Supermercado Araripe',        'RETAIL'),
  ('mirelly',      'Mirelly Supermercados',       'RETAIL');

-- Origem das ofertas. HTML/TEXT: páginas que o job lê (cadastradas à mão: a URL é uma decisão editorial e
-- precisa respeitar os termos e o robots.txt de cada rede). FLYER: encarte enviado por upload (uma fonte
-- por rede+bairro, criada pela API; a "url" é só um identificador e o job nunca a busca).
CREATE TABLE deal_sources (
  id              SERIAL       PRIMARY KEY,
  chain_id        INTEGER      NOT NULL REFERENCES retail_chains(id),
  url             TEXT         NOT NULL UNIQUE,
  neighborhood    VARCHAR(80),                       -- filial; NULL = oferta válida para a rede toda
  kind            VARCHAR(6)   NOT NULL DEFAULT 'HTML' CHECK (kind IN ('HTML', 'TEXT', 'FLYER')),
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  content_hash    CHAR(64),                          -- SHA-256 do texto da última leitura bem-sucedida: igual = não gasta o modelo
  last_scanned_at TIMESTAMPTZ,
  last_status     VARCHAR(10)  CHECK (last_status IN ('OK', 'UNCHANGED', 'EMPTY', 'ERROR')),
  last_error      TEXT
);

CREATE TABLE deals (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id          INTEGER       NOT NULL REFERENCES retail_chains(id),
  source_id         INTEGER       NOT NULL REFERENCES deal_sources(id),
  neighborhood      VARCHAR(80),
  product_name      VARCHAR(200)  NOT NULL,
  category          VARCHAR(40)   NOT NULL CHECK (category IN (
                      'Laticínios e Ovos', 'Hortifrúti', 'Açougue e Peixaria', 'Padaria e Matinais', 'Mercearia',
                      'Bebidas', 'Higiene e Beleza', 'Limpeza', 'Pet Shop')),
  brand             VARCHAR(80),
  unit              VARCHAR(10)   NOT NULL CHECK (unit IN ('un', 'kg', 'g', 'l', 'ml', 'pacote', 'bandeja')),
  wholesale_min_qty INTEGER       NOT NULL DEFAULT 1 CHECK (wholesale_min_qty >= 1),
  original_price    NUMERIC(10,2) CHECK (original_price > 0),
  discount_price    NUMERIC(10,2) NOT NULL CHECK (discount_price > 0),
  discount_pct      INTEGER       CHECK (discount_pct BETWEEN 1 AND 99),
  is_flash_deal     BOOLEAN       NOT NULL DEFAULT FALSE,
  coupon_eligible   BOOLEAN       NOT NULL DEFAULT FALSE,   -- >= 15% de desconto
  delivery_eligible BOOLEAN       NOT NULL DEFAULT FALSE,
  raw_offer_text    TEXT,
  first_seen_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),   -- renovado a cada leitura que ainda vê a oferta
  valid_until       TIMESTAMPTZ,                            -- encarte enviado: validade informada; NULL = vale 24 h após last_seen_at
  active            BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Mesma oferta lida de novo = atualiza a linha (o upsert do job usa esta chave).
CREATE UNIQUE INDEX uq_deals_identity ON deals (source_id, lower(product_name), wholesale_min_qty);
-- Vitrine: ofertas vigentes por bairro/rede, maiores descontos primeiro.
CREATE INDEX idx_deals_live ON deals (neighborhood, discount_pct DESC NULLS LAST) WHERE active;
CREATE INDEX idx_deals_name_trgm ON deals USING gin (product_name gin_trgm_ops) WHERE active;

-- Cupom de retirada: o cliente apresenta o código no caixa da rede.
-- Guarda o preço e o nome da oferta no momento da reserva (a linha em `deals` é reescrita a cada leitura).
CREATE TABLE deal_coupons (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(10)   NOT NULL UNIQUE,
  deal_id      UUID          NOT NULL REFERENCES deals(id),
  customer_id  UUID          NOT NULL REFERENCES users(id),
  product_name VARCHAR(200)  NOT NULL,
  unit_price   NUMERIC(10,2) NOT NULL,
  min_qty      INTEGER       NOT NULL DEFAULT 1,
  status       coupon_status NOT NULL DEFAULT 'ACTIVE',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ   NOT NULL,
  redeemed_at  TIMESTAMPTZ
);
-- Um cupom ativo por cliente e oferta.
CREATE UNIQUE INDEX uq_coupons_active ON deal_coupons (deal_id, customer_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_coupons_customer ON deal_coupons (customer_id, created_at DESC);

-- Quem pode enviar encarte de cada rede (gerente da rede ou parceiro autorizado). Sem esta tabela,
-- qualquer comerciante poderia publicar ofertas falsas em nome de uma rede — e gerar cupons.
CREATE TABLE retail_chain_managers (
  chain_id INTEGER NOT NULL REFERENCES retail_chains(id) ON DELETE CASCADE,
  user_id  UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (chain_id, user_id)
);

-- Auditoria dos encartes enviados (o arquivo em si não é guardado, só o que foi extraído dele).
CREATE TABLE flyer_uploads (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id        INTEGER      NOT NULL REFERENCES retail_chains(id),
  uploader_id     UUID         NOT NULL REFERENCES users(id),
  source_id       INTEGER      REFERENCES deal_sources(id),
  neighborhood    VARCHAR(80),
  file_name       VARCHAR(200),
  media_type      VARCHAR(20)  NOT NULL,
  size_bytes      INTEGER      NOT NULL,
  status          VARCHAR(10)  NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'SUCCESS', 'FAILED')),
  items_extracted INTEGER      NOT NULL DEFAULT 0,
  items_dropped   INTEGER      NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX idx_flyer_uploads_uploader ON flyer_uploads (uploader_id, created_at DESC);

-- ============================================================================
-- Dashboard Analítico (GET /api/v1/analytics/dashboard) — explicação em db/migrations/003-analytics-indices.sql
-- ============================================================================
CREATE INDEX idx_orders_merchant_created_cover ON orders (merchant_id, created_at) INCLUDE (status, total_price, payment_method);
CREATE INDEX idx_order_items_order_cover       ON order_items (order_id) INCLUDE (product_id, quantity, unit_price);
CREATE INDEX idx_coupons_deal                  ON deal_coupons (deal_id) INCLUDE (status, created_at);
CREATE INDEX idx_deals_source_seen             ON deals (source_id, last_seen_at);
CREATE INDEX idx_flyer_uploads_ok              ON flyer_uploads (uploader_id, created_at) INCLUDE (source_id) WHERE status = 'SUCCESS';

-- ============================================================================
-- Consolidado de db/migrations/004-logistica.sql (bancos já existentes usam `npm run migrate`).
-- ============================================================================
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

-- ============================================================================
-- Consolidado de db/migrations/005-operacao-loja.sql (bancos já existentes usam `npm run migrate`).
-- ============================================================================
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

-- ============================================================================
-- Consolidado de db/migrations/006-ofertas-relampago.sql (bancos já existentes usam `npm run migrate`).
-- ============================================================================
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

-- ============================================================================
-- Consolidado de db/migrations/007-carrinho-inteligente.sql (bancos já existentes usam `npm run migrate`).
-- ============================================================================
-- 007 · Carrinho Inteligente de Ingredientes / Cesta Básica.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- Problema central: "leite" é um item em 5 lojas com 5 nomes/marcas diferentes. Para comparar preço é preciso
-- um item CANÔNICO ao qual os produtos de cada loja se ligam. A receita ("feijoada") e a lista de compras falam
-- em itens canônicos; o motor de preços escolhe, entre as lojas do bairro, a combinação mais barata.
--
-- Otimização (feita na API, não no banco): custo total = soma dos itens + frete de CADA loja usada. Com as
-- ~8 lojas mais próximas, enumerar todos os subconjuntos de até 3 lojas (C(8,1)+C(8,2)+C(8,3) = 92) e, para cada
-- um, comprar cada item na loja mais barata do subconjunto é exato e instantâneo. Nada de heurística.

SET TIME ZONE 'America/Fortaleza';

CREATE TABLE IF NOT EXISTS canonical_products (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,                 -- "Leite integral 1 L"
  category_id INTEGER      REFERENCES categories(id),
  unit_kind   VARCHAR(4)   NOT NULL DEFAULT 'UN' CHECK (unit_kind IN ('UN', 'KG', 'L')),
  barcode     VARCHAR(14)  UNIQUE,                          -- EAN quando o item é uma marca/gramatura específica
  aliases     TEXT[]       NOT NULL DEFAULT '{}'            -- "leite caixinha", "leite longa vida" (busca)
);
CREATE INDEX IF NOT EXISTS idx_canonical_name_trgm ON canonical_products USING gin (name gin_trgm_ops);

-- Produto da loja → item canônico. NULL = ainda não classificado (fica fora da comparação).
-- A ligação nasce por código de barras (automática) ou pelo lojista/curadoria (manual).
ALTER TABLE products ADD COLUMN IF NOT EXISTS canonical_id INTEGER REFERENCES canonical_products(id);
CREATE INDEX IF NOT EXISTS idx_products_canonical ON products (canonical_id, user_id) WHERE active AND canonical_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recipes (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       VARCHAR(80)  NOT NULL UNIQUE,
  title      VARCHAR(160) NOT NULL,
  servings   SMALLINT     NOT NULL DEFAULT 4 CHECK (servings > 0),
  author_id  UUID         REFERENCES users(id) ON DELETE SET NULL,   -- NULL = receita curada pela plataforma
  is_public  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipes_title_trgm ON recipes USING gin (title gin_trgm_ops) WHERE is_public;

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id    UUID          NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  canonical_id INTEGER       NOT NULL REFERENCES canonical_products(id),
  quantity     NUMERIC(10,3) NOT NULL CHECK (quantity > 0),          -- para `servings` porções; a API escala
  optional     BOOLEAN       NOT NULL DEFAULT FALSE,                 -- "sal a gosto": não entra no menor custo
  PRIMARY KEY (recipe_id, canonical_id)
);

-- Lista de compras / cesta básica salva (também usada como "repetir compra do mês").
CREATE TABLE IF NOT EXISTS shopping_lists (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            VARCHAR(120) NOT NULL,
  source_recipe_id UUID         REFERENCES recipes(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      UUID          NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  canonical_id INTEGER       REFERENCES canonical_products(id),
  free_text    VARCHAR(120),                                         -- texto digitado que ainda não casou com um item canônico
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  CONSTRAINT list_item_has_target CHECK (canonical_id IS NOT NULL OR free_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_list_items (list_id);

-- Oferta de cada loja por item canônico, com o preço que o cliente pagaria hoje (inclui Salva-Estoque).
-- A API filtra por raio (distance_m) e passa para o otimizador.
CREATE OR REPLACE VIEW v_canonical_offers AS
SELECT p.canonical_id, p.id AS product_id, p.user_id AS merchant_id, p.name AS product_name, p.unit,
       p.stock_qty,
       product_effective_price(p.price, p.is_clearance, p.expiration_date) AS effective_price,
       u.store_name, u.neighborhood, u.latitude::float8 AS store_lat, u.longitude::float8 AS store_lng
  FROM products p
  JOIN users u ON u.id = p.user_id
 WHERE p.active AND p.canonical_id IS NOT NULL AND p.stock_qty > 0
   AND (p.expiration_date IS NULL OR p.expiration_date >= current_date);

-- ============================================================================
-- Consolidado de db/migrations/008-caderneta-encomendas-combos.sql (bancos já existentes usam `npm run migrate`).
-- ============================================================================
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

-- ============================================================================
-- Consolidado de db/migrations/009-clube-vip.sql (bancos já existentes usam `npm run migrate`).
-- ============================================================================
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


-- ============================================================================
-- 013 clube vip (consolidado de db/migrations/013-vip-ajustes.sql)
-- ============================================================================
-- 013 · Clube VIP: ajustes para o gateway de pagamento (idempotente).
-- Guarda no cadastro da assinatura as referências do provedor (cliente e assinatura recorrente) e cria o
-- registro de eventos de webhook já processados, que garante "mesmo evento N vezes = um efeito só".


ALTER TABLE vip_subscriptions ADD COLUMN IF NOT EXISTS provider              VARCHAR(20);
ALTER TABLE vip_subscriptions ADD COLUMN IF NOT EXISTS provider_customer_ref TEXT;
ALTER TABLE vip_subscriptions ADD COLUMN IF NOT EXISTS provider_sub_ref      TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vip_sub_provider_ref ON vip_subscriptions (provider, provider_sub_ref) WHERE provider_sub_ref IS NOT NULL;

-- Link de pagamento da fatura no provedor (Asaas: invoiceUrl, onde o cliente escolhe Pix/cartão).
ALTER TABLE vip_invoices ADD COLUMN IF NOT EXISTS payment_url TEXT;

CREATE TABLE IF NOT EXISTS vip_webhook_events (
  provider    VARCHAR(20)  NOT NULL,
  event_id    TEXT         NOT NULL,
  event_type  VARCHAR(60),
  received_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
