-- Domain: IoT device telemetry
-- Objects: 1 keyspace, 2 UDTs, 4 tables, 3 materialized views, 2 indexes, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS iot
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS iot.geo_point (lat double, lon double);
CREATE TYPE IF NOT EXISTS iot.device_meta (model text, firmware text, installed date);

CREATE TABLE IF NOT EXISTS iot.devices (
  device_id uuid PRIMARY KEY,
  name text,
  owner text,
  location frozen<geo_point>,
  meta frozen<device_meta>
);

CREATE TABLE IF NOT EXISTS iot.readings_by_device (
  device_id uuid,
  day date,
  ts timestamp,
  temperature double,
  humidity double,
  PRIMARY KEY ((device_id, day), ts)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND default_time_to_live = 7776000;

CREATE TABLE IF NOT EXISTS iot.alerts_by_device (
  device_id uuid,
  alert_time timeuuid,
  severity text,
  message text,
  PRIMARY KEY ((device_id), alert_time)
) WITH CLUSTERING ORDER BY (alert_time DESC);

CREATE TABLE IF NOT EXISTS iot.device_state (
  device_id uuid PRIMARY KEY,
  status text,
  battery int,
  last_seen timestamp
);

CREATE MATERIALIZED VIEW IF NOT EXISTS iot.devices_by_owner AS
  SELECT owner, device_id, name FROM iot.devices
  WHERE owner IS NOT NULL AND device_id IS NOT NULL
  PRIMARY KEY (owner, device_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS iot.alerts_by_severity AS
  SELECT severity, device_id, alert_time, message FROM iot.alerts_by_device
  WHERE severity IS NOT NULL AND device_id IS NOT NULL AND alert_time IS NOT NULL
  PRIMARY KEY ((severity), device_id, alert_time);

CREATE MATERIALIZED VIEW IF NOT EXISTS iot.devices_by_status AS
  SELECT status, device_id, battery, last_seen FROM iot.device_state
  WHERE status IS NOT NULL AND device_id IS NOT NULL
  PRIMARY KEY (status, device_id);

CREATE INDEX IF NOT EXISTS devices_name_idx ON iot.devices (name);
CREATE INDEX IF NOT EXISTS state_battery_idx ON iot.device_state (battery);

CREATE OR REPLACE FUNCTION iot.celsius_to_f(c double)
  RETURNS NULL ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ return c * 9.0 / 5.0 + 32.0; $$;

CREATE OR REPLACE FUNCTION iot.max_state(state double, val double)
  CALLED ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ if (val == null) return state; if (state == null) return val; return Math.max(state, val); $$;

CREATE OR REPLACE AGGREGATE iot.max_temp(double)
  SFUNC max_state STYPE double;

INSERT INTO iot.devices (device_id, name, owner, location, meta)
  VALUES (aaaaaaaa-0000-0000-0000-000000000001, 'greenhouse-1', 'farm-co', {lat: 52.52, lon: 13.40}, {model: 'TH-200', firmware: '2.4.1', installed: '2026-01-15'});
INSERT INTO iot.device_state (device_id, status, battery, last_seen)
  VALUES (aaaaaaaa-0000-0000-0000-000000000001, 'online', 87, toTimestamp(now()));
INSERT INTO iot.readings_by_device (device_id, day, ts, temperature, humidity)
  VALUES (aaaaaaaa-0000-0000-0000-000000000001, '2026-09-30', '2026-09-30 10:00:00', 21.5, 55.0);
INSERT INTO iot.readings_by_device (device_id, day, ts, temperature, humidity)
  VALUES (aaaaaaaa-0000-0000-0000-000000000001, '2026-09-30', '2026-09-30 10:05:00', 23.1, 54.2);
