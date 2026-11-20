-- 015 · Catálogo em tempo real. Idempotente.
-- Qualquer mudança em products ou categories (API, baixa de estoque de pedido, import por SQL, MCP) avisa a API via
-- LISTEN/NOTIFY no canal 'catalog_changed'; a API repassa a vitrine pelo Socket.io (namespace público /catalog).
-- FOR EACH STATEMENT: um import em lote gera uma notificação por comando, não uma por linha.
CREATE OR REPLACE FUNCTION notify_catalog_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('catalog_changed', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_catalog_changed ON products;
CREATE TRIGGER products_catalog_changed
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

DROP TRIGGER IF EXISTS categories_catalog_changed ON categories;
CREATE TRIGGER categories_catalog_changed
  AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();
