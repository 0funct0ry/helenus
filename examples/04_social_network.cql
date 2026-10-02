-- Domain: social network
-- Objects: 1 keyspace, 2 UDTs, 4 tables (one counter table), 3 materialized views, 2 indexes, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS social
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS social.profile_info (bio text, website text, location text);
CREATE TYPE IF NOT EXISTS social.media (url text, kind text);

CREATE TABLE IF NOT EXISTS social.users (
  user_id uuid PRIMARY KEY,
  handle text,
  display_name text,
  joined timestamp,
  info frozen<profile_info>
);

CREATE TABLE IF NOT EXISTS social.posts_by_user (
  user_id uuid,
  post_time timeuuid,
  post_id uuid,
  body text,
  media list<frozen<media>>,
  tags set<text>,
  PRIMARY KEY ((user_id), post_time)
) WITH CLUSTERING ORDER BY (post_time DESC);

CREATE TABLE IF NOT EXISTS social.followers (
  user_id uuid,
  follower_id uuid,
  since timestamp,
  PRIMARY KEY ((user_id), follower_id)
);

CREATE TABLE IF NOT EXISTS social.post_counters (
  post_id uuid PRIMARY KEY,
  likes counter,
  shares counter
);

CREATE MATERIALIZED VIEW IF NOT EXISTS social.users_by_handle AS
  SELECT handle, user_id, display_name FROM social.users
  WHERE handle IS NOT NULL AND user_id IS NOT NULL
  PRIMARY KEY (handle, user_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS social.following_by_follower AS
  SELECT follower_id, user_id, since FROM social.followers
  WHERE follower_id IS NOT NULL AND user_id IS NOT NULL
  PRIMARY KEY ((follower_id), user_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS social.posts_by_id AS
  SELECT post_id, user_id, post_time, body FROM social.posts_by_user
  WHERE post_id IS NOT NULL AND user_id IS NOT NULL AND post_time IS NOT NULL
  PRIMARY KEY ((post_id), user_id, post_time);

CREATE INDEX IF NOT EXISTS posts_tags_idx ON social.posts_by_user (tags);
CREATE INDEX IF NOT EXISTS users_name_idx ON social.users (display_name);

CREATE OR REPLACE FUNCTION social.hashtag_count(body text)
  CALLED ON NULL INPUT RETURNS int LANGUAGE java
  AS $$ if (body == null) return 0; int n = 0; for (char c : body.toCharArray()) { if (c == '#') n++; } return n; $$;

CREATE OR REPLACE FUNCTION social.sum_int(state int, val int)
  CALLED ON NULL INPUT RETURNS int LANGUAGE java
  AS $$ if (val == null) return state; return state + val; $$;

CREATE OR REPLACE AGGREGATE social.total_hashtags(int)
  SFUNC sum_int STYPE int INITCOND 0;

INSERT INTO social.users (user_id, handle, display_name, joined, info)
  VALUES (cccccccc-0000-0000-0000-000000000001, 'ada', 'Ada', toTimestamp(now()), {bio: 'Counting things', website: 'https://example.com', location: 'London'});
INSERT INTO social.posts_by_user (user_id, post_time, post_id, body, media, tags)
  VALUES (cccccccc-0000-0000-0000-000000000001, now(), uuid(), 'Hello #cassandra #cql', [{url: 'https://example.com/a.png', kind: 'image'}], {'cassandra', 'cql'});
UPDATE social.post_counters SET likes = likes + 3, shares = shares + 1 WHERE post_id = dddddddd-0000-0000-0000-000000000001;
