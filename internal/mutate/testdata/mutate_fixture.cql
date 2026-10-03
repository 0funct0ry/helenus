CREATE KEYSPACE labs WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;

CREATE TYPE labs.contact (
    id uuid,
    city text,
    visits bigint
);

CREATE TABLE labs.profiles (
    id uuid PRIMARY KEY,
    contact contact,
    nicks list<text>,
    scores set<int>,
    attrs map<text, int>,
    blob_keys map<blob, int>,
    big varint,
    since timestamp,
    ip inet,
    span duration,
    at time,
    born date,
    ratio float,
    price double,
    flag boolean,
    note text
);
