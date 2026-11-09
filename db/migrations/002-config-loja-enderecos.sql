-- Migração para bancos que já existem: configurações da loja, telefone, endereços e dados extras do pedido.
-- Bancos novos já recebem isto pelo db/schema.sql. Idempotente. Uso (banco local sem Docker):
--   npm run migrate   (em apps/api)

ALTER TABLE users  ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE users  ADD COLUMN IF NOT EXISTS store_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);

CREATE TABLE IF NOT EXISTS addresses (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        VARCHAR(40)  NOT NULL,
  street       VARCHAR(160) NOT NULL,
  neighborhood VARCHAR(80)  NOT NULL,
  city         VARCHAR(80)  NOT NULL,
  state        CHAR(2)      NOT NULL DEFAULT 'CE',
  zip          VARCHAR(9),
  is_primary   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_primary ON addresses (user_id) WHERE is_primary;
