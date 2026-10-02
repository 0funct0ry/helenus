-- Domain: human resources
-- Objects: 1 keyspace, 2 UDTs, 5 tables, 3 materialized views, 1 index, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS hr
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS hr.address (street text, city text, country text, postal_code text);
CREATE TYPE IF NOT EXISTS hr.comp (base decimal, bonus decimal, currency text);

CREATE TABLE IF NOT EXISTS hr.employees (
  employee_id uuid PRIMARY KEY,
  name text,
  email text,
  hired date,
  department text,
  title text,
  address frozen<address>,
  comp frozen<comp>
);

CREATE TABLE IF NOT EXISTS hr.departments (
  dept text PRIMARY KEY,
  head uuid,
  budget decimal,
  location text
);

CREATE TABLE IF NOT EXISTS hr.timesheets (
  employee_id uuid,
  week_start date,
  hours double,
  PRIMARY KEY ((employee_id), week_start)
) WITH CLUSTERING ORDER BY (week_start DESC);

CREATE TABLE IF NOT EXISTS hr.leave_requests (
  employee_id uuid,
  requested timeuuid,
  from_date date,
  to_date date,
  status text,
  PRIMARY KEY ((employee_id), requested)
) WITH CLUSTERING ORDER BY (requested DESC);

CREATE TABLE IF NOT EXISTS hr.reviews (
  employee_id uuid,
  review_year int,
  rating int,
  summary text,
  PRIMARY KEY ((employee_id), review_year)
) WITH CLUSTERING ORDER BY (review_year DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS hr.employees_by_email AS
  SELECT email, employee_id, name FROM hr.employees
  WHERE email IS NOT NULL AND employee_id IS NOT NULL
  PRIMARY KEY (email, employee_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS hr.employees_by_department AS
  SELECT department, employee_id, name, title FROM hr.employees
  WHERE department IS NOT NULL AND employee_id IS NOT NULL
  PRIMARY KEY ((department), employee_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS hr.leave_by_status AS
  SELECT status, employee_id, requested, from_date, to_date FROM hr.leave_requests
  WHERE status IS NOT NULL AND employee_id IS NOT NULL AND requested IS NOT NULL
  PRIMARY KEY ((status), employee_id, requested);

CREATE INDEX IF NOT EXISTS employees_title_idx ON hr.employees (title);

CREATE OR REPLACE FUNCTION hr.total_comp(base decimal, bonus decimal)
  RETURNS NULL ON NULL INPUT RETURNS decimal LANGUAGE java
  AS $$ return base.add(bonus); $$;

CREATE OR REPLACE FUNCTION hr.overtime_sum(state double, hours double)
  CALLED ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ if (hours == null) return state; return state + Math.max(0.0, hours - 40.0); $$;

CREATE OR REPLACE AGGREGATE hr.total_overtime(double)
  SFUNC overtime_sum STYPE double INITCOND 0.0;

INSERT INTO hr.employees (employee_id, name, email, hired, department, title, address, comp)
  VALUES (56565656-0000-0000-0000-000000000001, 'Katherine Johnson', 'kj@corp.example', '2023-04-17', 'engineering', 'Staff Engineer',
          {street: '3 Orbit Ln', city: 'Hampton', country: 'US', postal_code: '23666'}, {base: 142000, bonus: 15000, currency: 'USD'});
INSERT INTO hr.departments (dept, head, budget, location)
  VALUES ('engineering', 56565656-0000-0000-0000-000000000001, 2400000, 'Hampton');
INSERT INTO hr.timesheets (employee_id, week_start, hours)
  VALUES (56565656-0000-0000-0000-000000000001, '2026-09-21', 46.5);
INSERT INTO hr.timesheets (employee_id, week_start, hours)
  VALUES (56565656-0000-0000-0000-000000000001, '2026-09-28', 41.0);
