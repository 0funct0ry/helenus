CREATE KEYSPACE payments WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;

CREATE TYPE payments.address (
    street text,
    city text,
    country text,
    postal_code text
);

CREATE TYPE payments.geo_point (
    lat double,
    lon double
);

CREATE TYPE payments.billing_profile (
    name text,
    home frozen<address>,
    points list<frozen<geo_point>>
);

CREATE TABLE payments.transactions_by_merchant (
    merchant_id uuid,
    txn_day date,
    txn_time timeuuid,
    merchant_name text STATIC,
    amount decimal,
    currency text,
    status text,
    tags set<text>,
    metadata map<text, text>,
    billing frozen<address>,
    history list<decimal>,
    geo tuple<double, double>,
    raw_payload blob,
    PRIMARY KEY ((merchant_id, txn_day), txn_time)
) WITH CLUSTERING ORDER BY (txn_time DESC)
    AND default_time_to_live = 7776000
    AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_size': '1', 'compaction_window_unit': 'DAYS'};

CREATE INDEX txn_by_currency ON payments.transactions_by_merchant (currency);

CREATE MATERIALIZED VIEW payments.transactions_by_status AS
    SELECT merchant_id, txn_day, txn_time, status, amount
    FROM payments.transactions_by_merchant
    WHERE status IS NOT NULL AND merchant_id IS NOT NULL AND txn_day IS NOT NULL AND txn_time IS NOT NULL
    PRIMARY KEY ((status), merchant_id, txn_day, txn_time)
    WITH CLUSTERING ORDER BY (merchant_id ASC, txn_day ASC, txn_time DESC);

CREATE TABLE payments.ledger_counters (
    account_id uuid,
    day date,
    debits counter,
    credits counter,
    PRIMARY KEY (account_id, day)
) WITH CLUSTERING ORDER BY (day DESC);

CREATE TABLE payments.merchants (
    merchant_id uuid PRIMARY KEY,
    name text,
    billing frozen<billing_profile>,
    contacts map<text, frozen<address>>,
    categories frozen<set<text>>,
    nested map<text, frozen<list<frozen<tuple<int, text>>>>>
);

CREATE FUNCTION payments.add_cents(a int, b int) CALLED ON NULL INPUT RETURNS int LANGUAGE java AS 'return a + b;';

CREATE AGGREGATE payments.sum_cents(int) SFUNC add_cents STYPE int INITCOND 0;
