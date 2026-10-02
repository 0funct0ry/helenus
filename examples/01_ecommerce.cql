-- Domain: e-commerce storefront
-- Objects: 1 keyspace, 2 UDTs, 4 tables, 3 materialized views, 2 indexes, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS shop
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS shop.address (
  street text, city text, country text, postal_code text
);

CREATE TYPE IF NOT EXISTS shop.price_tier (
  min_qty int, unit_price decimal
);

CREATE TABLE IF NOT EXISTS shop.customers (
  customer_id uuid PRIMARY KEY,
  email text,
  name text,
  address frozen<address>
);

CREATE TABLE IF NOT EXISTS shop.products (
  product_id uuid PRIMARY KEY,
  sku text,
  name text,
  price decimal,
  tags set<text>,
  tiers list<frozen<price_tier>>
);

CREATE TABLE IF NOT EXISTS shop.orders_by_customer (
  customer_id uuid,
  order_time timeuuid,
  order_id uuid,
  status text,
  total decimal,
  ship_to frozen<address>,
  PRIMARY KEY ((customer_id), order_time)
) WITH CLUSTERING ORDER BY (order_time DESC);

CREATE TABLE IF NOT EXISTS shop.order_items (
  order_id uuid,
  line_no int,
  product_id uuid,
  qty int,
  unit_price decimal,
  PRIMARY KEY ((order_id), line_no)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS shop.customers_by_email AS
  SELECT email, customer_id, name FROM shop.customers
  WHERE email IS NOT NULL AND customer_id IS NOT NULL
  PRIMARY KEY (email, customer_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS shop.products_by_sku AS
  SELECT sku, product_id, name, price FROM shop.products
  WHERE sku IS NOT NULL AND product_id IS NOT NULL
  PRIMARY KEY (sku, product_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS shop.orders_by_status AS
  SELECT status, customer_id, order_time, order_id, total FROM shop.orders_by_customer
  WHERE status IS NOT NULL AND customer_id IS NOT NULL AND order_time IS NOT NULL
  PRIMARY KEY ((status), customer_id, order_time);

CREATE INDEX IF NOT EXISTS products_tags_idx ON shop.products (tags);
CREATE INDEX IF NOT EXISTS customers_name_idx ON shop.customers (name);

CREATE OR REPLACE FUNCTION shop.line_total(qty int, price decimal)
  RETURNS NULL ON NULL INPUT RETURNS decimal LANGUAGE java
  AS $$ return price.multiply(java.math.BigDecimal.valueOf(qty)); $$;

CREATE OR REPLACE FUNCTION shop.sum_qty(state int, val int)
  CALLED ON NULL INPUT RETURNS int LANGUAGE java
  AS $$ if (val == null) return state; return state + val; $$;

CREATE OR REPLACE AGGREGATE shop.total_qty(int)
  SFUNC sum_qty STYPE int INITCOND 0;

INSERT INTO shop.customers (customer_id, email, name, address)
  VALUES (uuid(), 'ada@example.com', 'Ada Lovelace', {street: '1 Analytical Way', city: 'London', country: 'UK', postal_code: 'N1 9GU'});
INSERT INTO shop.products (product_id, sku, name, price, tags, tiers)
  VALUES (uuid(), 'KB-001', 'Mechanical Keyboard', 89.90, {'peripherals', 'office'}, [{min_qty: 1, unit_price: 89.90}, {min_qty: 10, unit_price: 79.90}]);
INSERT INTO shop.order_items (order_id, line_no, product_id, qty, unit_price)
  VALUES (11111111-1111-1111-1111-111111111111, 1, uuid(), 3, 89.90);
INSERT INTO shop.order_items (order_id, line_no, product_id, qty, unit_price)
  VALUES (11111111-1111-1111-1111-111111111111, 2, uuid(), 2, 19.50);
