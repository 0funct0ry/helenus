-- Domain: logistics and shipping
-- Objects: 1 keyspace, 2 UDTs, 5 tables, 3 materialized views, 1 index, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS logistics
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS logistics.dimensions (length_cm double, width_cm double, height_cm double);
CREATE TYPE IF NOT EXISTS logistics.stop (city text, country text, eta timestamp);

CREATE TABLE IF NOT EXISTS logistics.warehouses (
  warehouse_id uuid PRIMARY KEY,
  name text,
  city text,
  capacity int
);

CREATE TABLE IF NOT EXISTS logistics.shipments (
  shipment_id uuid PRIMARY KEY,
  tracking text,
  status text,
  weight_kg double,
  dims frozen<dimensions>,
  origin uuid,
  route list<frozen<stop>>
);

CREATE TABLE IF NOT EXISTS logistics.shipment_events (
  shipment_id uuid,
  event_time timeuuid,
  location text,
  event text,
  PRIMARY KEY ((shipment_id), event_time)
) WITH CLUSTERING ORDER BY (event_time DESC);

CREATE TABLE IF NOT EXISTS logistics.inventory (
  warehouse_id uuid,
  sku text,
  quantity int,
  PRIMARY KEY ((warehouse_id), sku)
);

CREATE TABLE IF NOT EXISTS logistics.vehicles (
  vehicle_id uuid PRIMARY KEY,
  plate text,
  capacity_kg double,
  driver text
);

CREATE MATERIALIZED VIEW IF NOT EXISTS logistics.shipments_by_tracking AS
  SELECT tracking, shipment_id, status FROM logistics.shipments
  WHERE tracking IS NOT NULL AND shipment_id IS NOT NULL
  PRIMARY KEY (tracking, shipment_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS logistics.shipments_by_status AS
  SELECT status, shipment_id, tracking, weight_kg FROM logistics.shipments
  WHERE status IS NOT NULL AND shipment_id IS NOT NULL
  PRIMARY KEY ((status), shipment_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS logistics.vehicles_by_plate AS
  SELECT plate, vehicle_id, driver, capacity_kg FROM logistics.vehicles
  WHERE plate IS NOT NULL AND vehicle_id IS NOT NULL
  PRIMARY KEY (plate, vehicle_id);

CREATE INDEX IF NOT EXISTS warehouses_city_idx ON logistics.warehouses (city);

CREATE OR REPLACE FUNCTION logistics.volume_m3(l double, w double, h double)
  RETURNS NULL ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ return (l * w * h) / 1000000.0; $$;

CREATE OR REPLACE FUNCTION logistics.sum_double(state double, val double)
  CALLED ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ if (val == null) return state; return state + val; $$;

CREATE OR REPLACE AGGREGATE logistics.total_weight(double)
  SFUNC sum_double STYPE double INITCOND 0.0;

INSERT INTO logistics.warehouses (warehouse_id, name, city, capacity)
  VALUES (ffffffff-0000-0000-0000-000000000001, 'Hub North', 'Hamburg', 50000);
INSERT INTO logistics.shipments (shipment_id, tracking, status, weight_kg, dims, origin, route)
  VALUES (uuid(), 'TRK-100200', 'in_transit', 12.5, {length_cm: 60, width_cm: 40, height_cm: 30}, ffffffff-0000-0000-0000-000000000001,
          [{city: 'Hamburg', country: 'DE', eta: '2026-10-02 08:00:00'}, {city: 'Prague', country: 'CZ', eta: '2026-10-03 14:00:00'}]);
INSERT INTO logistics.inventory (warehouse_id, sku, quantity)
  VALUES (ffffffff-0000-0000-0000-000000000001, 'PALLET-A', 120);
INSERT INTO logistics.vehicles (vehicle_id, plate, capacity_kg, driver)
  VALUES (uuid(), 'HH-AB-1234', 18000.0, 'Jonas');
