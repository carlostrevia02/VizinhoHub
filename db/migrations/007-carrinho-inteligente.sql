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
