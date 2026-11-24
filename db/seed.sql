-- Dados de desenvolvimento (NÃO usar em produção). IDs fixos para facilitar testes.
SET TIME ZONE 'America/Fortaleza';

INSERT INTO categories (name) VALUES
  ('Mercearia'), ('Frios e Laticínios'), ('Bebidas'), ('Padaria'), ('Limpeza'), ('Higiene');

-- Dois mercadinhos no mesmo bairro (Aldeota); um cliente.
-- Os três também entram por e-mail/senha na API (login de desenvolvimento): senha "vizinho123".
INSERT INTO users (id, name, email, password_hash, firebase_uid, role, store_name, neighborhood, city, latitude, longitude) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Zé Mercador',  'ze@vizinhohub.test', 'scrypt$gKcPPGRl7L6VEDQ9S5QQZA==$zFw4gk6d9PKdQ/C++aQhsb7fJlCn7SobXHaweyXrcF3su4Q0X7RqBhwsyFxECbbk9m3AdnEw+e8qC1dzshF27Q==', 'seed-merchant-ze',   'MERCHANT', 'Mercadinho do Zé',     'Aldeota', 'Fortaleza', -3.737100, -38.496000),
  ('22222222-2222-4222-8222-222222222222', 'Lúcia Rocha',  'lucia@vizinhohub.test', 'scrypt$gKcPPGRl7L6VEDQ9S5QQZA==$zFw4gk6d9PKdQ/C++aQhsb7fJlCn7SobXHaweyXrcF3su4Q0X7RqBhwsyFxECbbk9m3AdnEw+e8qC1dzshF27Q==', 'seed-merchant-lucia','MERCHANT', 'Mercadinho da Dona Lúcia','Aldeota', 'Fortaleza', -3.740500, -38.493200),
  ('33333333-3333-4333-8333-333333333333', 'Maria Souza',  'maria@vizinhohub.test', 'scrypt$gKcPPGRl7L6VEDQ9S5QQZA==$zFw4gk6d9PKdQ/C++aQhsb7fJlCn7SobXHaweyXrcF3su4Q0X7RqBhwsyFxECbbk9m3AdnEw+e8qC1dzshF27Q==', 'seed-customer-maria','CUSTOMER', NULL, NULL, NULL, NULL, NULL);

INSERT INTO products (id, user_id, category_id, name, description, price, expiration_date, barcode) VALUES
  -- Loja do Zé
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 2, 'Creme de Leite Nestlé 200g',  NULL, 4.29, current_date + 40, NULL),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 2, 'Iogurte Molico Morango 170g', NULL, 3.89, current_date + 2,  NULL),  -- Salva-Estoque (30%)
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 1, 'Arroz Camil Integral 1kg',    NULL, 7.46, NULL,             '7896006711119'),
  ('aaaaaaaa-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 4, 'Pão de Forma Wickbold 500g',  NULL, 8.90, current_date + 1,  NULL),  -- Salva-Estoque (50%)
  -- Loja da Dona Lúcia
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 1, 'Arroz Camil Integral 1kg',    NULL, 7.20, NULL,             '7896006711119'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 3, 'Suco Del Valle Uva 1L',       NULL, 6.50, current_date + 90, NULL);

-- Aplica a regra do Salva-Estoque aos dados de exemplo.
SELECT refresh_clearance();
