-- Domain: online multiplayer gaming
-- Objects: 1 keyspace, 2 UDTs, 5 tables, 3 materialized views, 1 index, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS arena
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS arena.stats (kills int, deaths int, assists int);
CREATE TYPE IF NOT EXISTS arena.item (item_id text, name text, rarity text);

CREATE TABLE IF NOT EXISTS arena.players (
  player_id uuid PRIMARY KEY,
  nickname text,
  level int,
  created timestamp,
  inventory list<frozen<item>>
);

CREATE TABLE IF NOT EXISTS arena.matches (
  match_id uuid PRIMARY KEY,
  map text,
  mode text,
  started timestamp
);

CREATE TABLE IF NOT EXISTS arena.match_results (
  match_id uuid,
  player_id uuid,
  stats frozen<stats>,
  score int,
  PRIMARY KEY ((match_id), player_id)
);

CREATE TABLE IF NOT EXISTS arena.leaderboard (
  season text,
  bucket int,
  score int,
  player_id uuid,
  nickname text,
  PRIMARY KEY ((season, bucket), score, player_id)
) WITH CLUSTERING ORDER BY (score DESC, player_id ASC);

CREATE TABLE IF NOT EXISTS arena.achievements (
  player_id uuid,
  earned timeuuid,
  name text,
  PRIMARY KEY ((player_id), earned)
) WITH CLUSTERING ORDER BY (earned DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS arena.players_by_nickname AS
  SELECT nickname, player_id, level FROM arena.players
  WHERE nickname IS NOT NULL AND player_id IS NOT NULL
  PRIMARY KEY (nickname, player_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS arena.results_by_player AS
  SELECT player_id, match_id, score, stats FROM arena.match_results
  WHERE player_id IS NOT NULL AND match_id IS NOT NULL
  PRIMARY KEY ((player_id), match_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS arena.matches_by_mode AS
  SELECT mode, match_id, map, started FROM arena.matches
  WHERE mode IS NOT NULL AND match_id IS NOT NULL
  PRIMARY KEY ((mode), match_id);

CREATE INDEX IF NOT EXISTS players_level_idx ON arena.players (level);

CREATE OR REPLACE FUNCTION arena.kda(kills int, deaths int, assists int)
  RETURNS NULL ON NULL INPUT RETURNS double LANGUAGE java
  AS $$ return (kills + assists) / (double) Math.max(1, deaths); $$;

CREATE OR REPLACE FUNCTION arena.sum_int(state int, val int)
  CALLED ON NULL INPUT RETURNS int LANGUAGE java
  AS $$ if (val == null) return state; return state + val; $$;

CREATE OR REPLACE AGGREGATE arena.total_score(int)
  SFUNC sum_int STYPE int INITCOND 0;

INSERT INTO arena.players (player_id, nickname, level, created, inventory)
  VALUES (99999999-0000-0000-0000-000000000001, 'Nova', 42, toTimestamp(now()),
          [{item_id: 'sword-01', name: 'Flame Sword', rarity: 'epic'}]);
INSERT INTO arena.matches (match_id, map, mode, started)
  VALUES (99999999-0000-0000-0000-0000000000a1, 'canyon', 'ranked', toTimestamp(now()));
INSERT INTO arena.match_results (match_id, player_id, stats, score)
  VALUES (99999999-0000-0000-0000-0000000000a1, 99999999-0000-0000-0000-000000000001, {kills: 12, deaths: 4, assists: 7}, 2450);
INSERT INTO arena.leaderboard (season, bucket, score, player_id, nickname)
  VALUES ('2026-s3', 0, 2450, 99999999-0000-0000-0000-000000000001, 'Nova');
