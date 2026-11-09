-- Migração para bancos que já existem (docker volume antigo): aplica só as tabelas de Ofertas do Bairro.
-- Bancos novos já recebem isto pelo db/schema.sql. Uso:
--   docker compose exec -T db psql -U vizinhohub -d vizinhohub < db/migrations/001-ofertas-do-bairro.sql

SET TIME ZONE 'America/Fortaleza';

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
