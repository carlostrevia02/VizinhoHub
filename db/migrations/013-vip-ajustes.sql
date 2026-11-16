-- 013 · Clube VIP: ajustes para o gateway de pagamento (idempotente).
-- Guarda no cadastro da assinatura as referências do provedor (cliente e assinatura recorrente) e cria o
-- registro de eventos de webhook já processados, que garante "mesmo evento N vezes = um efeito só".

SET TIME ZONE 'America/Fortaleza';

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
