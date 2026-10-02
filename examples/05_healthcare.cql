-- Domain: healthcare / patient records
-- Objects: 1 keyspace, 2 UDTs, 5 tables, 3 materialized views, 1 index, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS clinic
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS clinic.address (street text, city text, country text, postal_code text);
CREATE TYPE IF NOT EXISTS clinic.vitals (heart_rate int, systolic int, diastolic int, spo2 int);

CREATE TABLE IF NOT EXISTS clinic.patients (
  patient_id uuid PRIMARY KEY,
  mrn text,
  name text,
  birth_date date,
  blood_type text,
  address frozen<address>
);

CREATE TABLE IF NOT EXISTS clinic.doctors (
  doctor_id uuid PRIMARY KEY,
  name text,
  specialty text,
  clinic_name text
);

CREATE TABLE IF NOT EXISTS clinic.appointments_by_patient (
  patient_id uuid,
  appt_time timestamp,
  doctor_id uuid,
  reason text,
  status text,
  PRIMARY KEY ((patient_id), appt_time)
);

CREATE TABLE IF NOT EXISTS clinic.observations_by_patient (
  patient_id uuid,
  obs_time timeuuid,
  vitals frozen<vitals>,
  notes text,
  PRIMARY KEY ((patient_id), obs_time)
) WITH CLUSTERING ORDER BY (obs_time DESC);

CREATE TABLE IF NOT EXISTS clinic.prescriptions (
  patient_id uuid,
  rx_time timeuuid,
  drug text,
  dose_mg int,
  days int,
  PRIMARY KEY ((patient_id), rx_time)
) WITH CLUSTERING ORDER BY (rx_time DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS clinic.patients_by_mrn AS
  SELECT mrn, patient_id, name FROM clinic.patients
  WHERE mrn IS NOT NULL AND patient_id IS NOT NULL
  PRIMARY KEY (mrn, patient_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS clinic.doctors_by_specialty AS
  SELECT specialty, doctor_id, name FROM clinic.doctors
  WHERE specialty IS NOT NULL AND doctor_id IS NOT NULL
  PRIMARY KEY ((specialty), doctor_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS clinic.appointments_by_doctor AS
  SELECT doctor_id, appt_time, patient_id, reason, status FROM clinic.appointments_by_patient
  WHERE doctor_id IS NOT NULL AND appt_time IS NOT NULL AND patient_id IS NOT NULL
  PRIMARY KEY ((doctor_id), appt_time, patient_id);

CREATE INDEX IF NOT EXISTS patients_blood_idx ON clinic.patients (blood_type);

CREATE OR REPLACE FUNCTION clinic.bmi(weight_kg double, height_cm double)
  RETURNS NULL ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ double m = height_cm / 100.0; return weight_kg / (m * m); $$;

CREATE OR REPLACE FUNCTION clinic.max_int(state int, val int)
  CALLED ON NULL INPUT RETURNS int LANGUAGE java
  AS $$ if (val == null) return state; if (state == null) return val; return Math.max(state, val); $$;

CREATE OR REPLACE AGGREGATE clinic.max_dose(int)
  SFUNC max_int STYPE int;

INSERT INTO clinic.patients (patient_id, mrn, name, birth_date, blood_type, address)
  VALUES (eeeeeeee-0000-0000-0000-000000000001, 'MRN-0001', 'Alan Turing', '1985-06-23', 'O+',
          {street: '9 Bletchley Rd', city: 'Milton Keynes', country: 'UK', postal_code: 'MK3 6EB'});
INSERT INTO clinic.doctors (doctor_id, name, specialty, clinic_name)
  VALUES (eeeeeeee-0000-0000-0000-0000000000d1, 'Dr. Curie', 'cardiology', 'Central Clinic');
INSERT INTO clinic.observations_by_patient (patient_id, obs_time, vitals, notes)
  VALUES (eeeeeeee-0000-0000-0000-000000000001, now(), {heart_rate: 72, systolic: 118, diastolic: 76, spo2: 98}, 'Routine check');
INSERT INTO clinic.prescriptions (patient_id, rx_time, drug, dose_mg, days)
  VALUES (eeeeeeee-0000-0000-0000-000000000001, now(), 'Atorvastatin', 20, 30);
