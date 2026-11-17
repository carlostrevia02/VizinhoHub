-- 014 · Logística: entrega pela frota própria da loja. Idempotente.
-- Na frota própria quem leva é alguém da loja, sem perfil em couriers: a entrega passa por PICKED_UP e
-- DELIVERED com courier_id NULL. ACCEPTED continua exigindo entregador (é o aceite de um convite do pool).
-- Quem garante que só a frota própria anda sem entregador é a API (delivery.service: rotas own-fleet).
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_courier_when_moving;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_courier_when_moving CHECK (
  courier_id IS NOT NULL OR status IN ('REQUESTED', 'OFFERED', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'FAILED')
);
