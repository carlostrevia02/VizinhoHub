-- 010 · Logística: ajustes. Idempotente.
--  * O PIN de entrega é purgado (NULL) no instante em que a entrega é confirmada: por isso pin_code deixa
--    de ser NOT NULL, mas segue obrigatório enquanto a entrega está em andamento.
ALTER TABLE deliveries ALTER COLUMN pin_code DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE deliveries ADD CONSTRAINT deliveries_pin_while_open
    CHECK (pin_code IS NOT NULL OR status IN ('DELIVERED', 'FAILED', 'CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
