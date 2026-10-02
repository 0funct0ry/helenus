-- Domain: video streaming
-- Objects: 1 keyspace, 2 UDTs, 5 tables, 3 materialized views, 1 index, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS streaming
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS streaming.episode_ref (season int, number int);
CREATE TYPE IF NOT EXISTS streaming.artwork (url text, width int, height int);

CREATE TABLE IF NOT EXISTS streaming.titles (
  title_id uuid PRIMARY KEY,
  name text,
  kind text,
  year int,
  genres set<text>,
  poster frozen<artwork>
);

CREATE TABLE IF NOT EXISTS streaming.episodes_by_title (
  title_id uuid,
  season int,
  number int,
  name text,
  duration_sec int,
  PRIMARY KEY ((title_id), season, number)
);

CREATE TABLE IF NOT EXISTS streaming.viewers (
  viewer_id uuid PRIMARY KEY,
  email text,
  plan text,
  joined date
);

CREATE TABLE IF NOT EXISTS streaming.watch_history (
  viewer_id uuid,
  watched_at timeuuid,
  title_id uuid,
  last_episode frozen<episode_ref>,
  position_sec int,
  finished boolean,
  PRIMARY KEY ((viewer_id), watched_at)
) WITH CLUSTERING ORDER BY (watched_at DESC);

CREATE TABLE IF NOT EXISTS streaming.ratings (
  title_id uuid,
  viewer_id uuid,
  stars int,
  PRIMARY KEY ((title_id), viewer_id)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS streaming.titles_by_kind AS
  SELECT kind, title_id, name, year FROM streaming.titles
  WHERE kind IS NOT NULL AND title_id IS NOT NULL
  PRIMARY KEY ((kind), title_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS streaming.viewers_by_email AS
  SELECT email, viewer_id, plan FROM streaming.viewers
  WHERE email IS NOT NULL AND viewer_id IS NOT NULL
  PRIMARY KEY (email, viewer_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS streaming.ratings_by_viewer AS
  SELECT viewer_id, title_id, stars FROM streaming.ratings
  WHERE viewer_id IS NOT NULL AND title_id IS NOT NULL
  PRIMARY KEY ((viewer_id), title_id);

CREATE INDEX IF NOT EXISTS titles_genres_idx ON streaming.titles (genres);

CREATE OR REPLACE FUNCTION streaming.format_duration(sec int)
  RETURNS NULL ON NULL INPUT RETURNS text LANGUAGE java
  AS $$ return String.format("%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60); $$;

CREATE OR REPLACE FUNCTION streaming.sum_int(state int, val int)
  CALLED ON NULL INPUT RETURNS int LANGUAGE java
  AS $$ if (val == null) return state; return state + val; $$;

CREATE OR REPLACE AGGREGATE streaming.total_seconds(int)
  SFUNC sum_int STYPE int INITCOND 0;

INSERT INTO streaming.titles (title_id, name, kind, year, genres, poster)
  VALUES (34343434-0000-0000-0000-000000000001, 'Deep Space Diaries', 'series', 2025, {'sci-fi', 'drama'},
          {url: 'https://cdn.example/posters/dsd.jpg', width: 600, height: 900});
INSERT INTO streaming.episodes_by_title (title_id, season, number, name, duration_sec)
  VALUES (34343434-0000-0000-0000-000000000001, 1, 1, 'Launch Window', 2710);
INSERT INTO streaming.viewers (viewer_id, email, plan, joined)
  VALUES (34343434-0000-0000-0000-0000000000a1, 'viewer@example.com', 'premium', '2025-01-10');
INSERT INTO streaming.watch_history (viewer_id, watched_at, title_id, last_episode, position_sec, finished)
  VALUES (34343434-0000-0000-0000-0000000000a1, now(), 34343434-0000-0000-0000-000000000001, {season: 1, number: 1}, 1500, false);
