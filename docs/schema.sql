-- VizinhoHub — esquema inicial (PostgreSQL)
CREATE TYPE user_role AS ENUM ('ADMIN', 'CUSTOMER');
CREATE TYPE order_status AS ENUM ('PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED', 'CANCELLED');

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role NOT NULL DEFAULT 'CUSTOMER'
);

CREATE TABLE categories (
  id   BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE products (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  category_id BIGINT NOT NULL REFERENCES categories(id),
  name        VARCHAR(160) NOT NULL,
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock_qty   INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0), -- impede estoque negativo (concorrência)
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE orders (
  id            BIGSERIAL PRIMARY KEY,
  customer_name VARCHAR(120) NOT NULL,
  total_price   NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
  status        order_status NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
