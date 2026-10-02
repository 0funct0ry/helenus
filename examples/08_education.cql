-- Domain: university / e-learning
-- Objects: 1 keyspace, 2 UDTs, 5 tables, 3 materialized views, 1 index, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS campus
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS campus.contact (email text, phone text);
CREATE TYPE IF NOT EXISTS campus.grade (course text, score double, term text);

CREATE TABLE IF NOT EXISTS campus.students (
  student_id uuid PRIMARY KEY,
  name text,
  enrolled date,
  contact frozen<contact>,
  best_grades list<frozen<grade>>
);

CREATE TABLE IF NOT EXISTS campus.courses (
  course_id text PRIMARY KEY,
  title text,
  credits int,
  department text
);

CREATE TABLE IF NOT EXISTS campus.enrollments (
  course_id text,
  student_id uuid,
  enrolled_at timestamp,
  grade double,
  PRIMARY KEY ((course_id), student_id)
);

CREATE TABLE IF NOT EXISTS campus.grades_by_student (
  student_id uuid,
  term text,
  course_id text,
  score double,
  PRIMARY KEY ((student_id), term, course_id)
);

CREATE TABLE IF NOT EXISTS campus.instructors (
  instructor_id uuid PRIMARY KEY,
  name text,
  department text,
  office text
);

CREATE MATERIALIZED VIEW IF NOT EXISTS campus.students_by_name AS
  SELECT name, student_id, enrolled FROM campus.students
  WHERE name IS NOT NULL AND student_id IS NOT NULL
  PRIMARY KEY (name, student_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS campus.courses_by_department AS
  SELECT department, course_id, title, credits FROM campus.courses
  WHERE department IS NOT NULL AND course_id IS NOT NULL
  PRIMARY KEY ((department), course_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS campus.enrollments_by_student AS
  SELECT student_id, course_id, enrolled_at, grade FROM campus.enrollments
  WHERE student_id IS NOT NULL AND course_id IS NOT NULL
  PRIMARY KEY ((student_id), course_id);

CREATE INDEX IF NOT EXISTS instructors_dept_idx ON campus.instructors (department);

CREATE OR REPLACE FUNCTION campus.letter_grade(score double)
  RETURNS NULL ON NULL INPUT RETURNS text LANGUAGE java
  AS $$ if (score >= 90) return "A"; if (score >= 80) return "B"; if (score >= 70) return "C"; if (score >= 60) return "D"; return "F"; $$;

CREATE OR REPLACE FUNCTION campus.max_double(state double, val double)
  CALLED ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ if (val == null) return state; if (state == null) return val; return Math.max(state, val); $$;

CREATE OR REPLACE AGGREGATE campus.best_score(double)
  SFUNC max_double STYPE double;

INSERT INTO campus.students (student_id, name, enrolled, contact, best_grades)
  VALUES (12121212-0000-0000-0000-000000000001, 'Emmy Noether', '2025-09-01', {email: 'emmy@campus.example', phone: '+4915112345'},
          [{course: 'ALG101', score: 97.5, term: '2025-fall'}]);
INSERT INTO campus.courses (course_id, title, credits, department)
  VALUES ('ALG101', 'Abstract Algebra', 6, 'mathematics');
INSERT INTO campus.enrollments (course_id, student_id, enrolled_at, grade)
  VALUES ('ALG101', 12121212-0000-0000-0000-000000000001, toTimestamp(now()), 97.5);
INSERT INTO campus.grades_by_student (student_id, term, course_id, score)
  VALUES (12121212-0000-0000-0000-000000000001, '2025-fall', 'ALG101', 97.5);
