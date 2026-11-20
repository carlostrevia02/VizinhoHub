-- 018 · Filiais das redes de supermercado. Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- retail_chains guarda só a rede (ex.: São Luiz); para saber qual filial fica perto do cliente é preciso a localização
-- de cada loja. A fonte pode ser o OpenStreetMap ('OSM'), o Google Places ('GOOGLE') ou cadastro à mão ('MANUAL');
-- source_ref guarda o id externo (ex.: 'node/123') para reimportar sem duplicar.
--
-- UNIQUE (chain_id, source, source_ref) e NULL: no Postgres, NULL é distinto de NULL em índices únicos, então filiais
-- 'MANUAL' sem source_ref NÃO são deduplicadas entre si (podem existir várias da mesma rede). Isso é intencional: o
-- cadastro manual não tem id externo. A garantia de "uma linha por filial" vale para OSM/GOOGLE, que sempre trazem
-- source_ref; se um dia for preciso barrar duplicatas manuais, basta preencher source_ref (ou usar NULLS NOT DISTINCT, PG 15+).
CREATE TABLE IF NOT EXISTS chain_branches (
  id           SERIAL        PRIMARY KEY,
  chain_id     INTEGER       NOT NULL REFERENCES retail_chains(id),
  name         VARCHAR(120)  NOT NULL,
  address      TEXT,
  neighborhood VARCHAR(80),
  latitude     NUMERIC(9,6)  NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude    NUMERIC(9,6)  NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source       VARCHAR(10)   NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('OSM', 'GOOGLE', 'MANUAL')),
  source_ref   VARCHAR(40),
  active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_chain_branches_source UNIQUE (chain_id, source, source_ref)
);

-- "Filiais ativas mais próximas de um ponto" (earthdistance, como idx_users_merchant_geo) e "filiais ativas de uma rede".
CREATE INDEX IF NOT EXISTS idx_chain_branches_geo   ON chain_branches USING gist (ll_to_earth(latitude, longitude)) WHERE active;
CREATE INDEX IF NOT EXISTS idx_chain_branches_chain ON chain_branches (chain_id) WHERE active;
