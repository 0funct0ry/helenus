
CREATE TABLE payments.transactions_by_merchant (
    merchant_id uuid,
    txn_day date,
    txn_time timeuuid,
    merchant_name text static,
    amount decimal,
    billing frozen<address>,
    currency text,
    geo frozen<tuple<double, double>>,
    raw_payload blob,
    status text,
    history list<decimal>,
    metadata map<text, text>,
    tags set<text>,
    PRIMARY KEY ((merchant_id, txn_day), txn_time)
) WITH CLUSTERING ORDER BY (txn_time DESC)
    AND additional_write_policy = '99p'
    AND allow_auto_snapshot = true
    AND bloom_filter_fp_chance = 0.01
    AND caching = {'keys': 'ALL', 'rows_per_partition': 'NONE'}
    AND cdc = false
    AND comment = ''
    AND compaction = {'class': 'org.apache.cassandra.db.compaction.TimeWindowCompactionStrategy', 'compaction_window_size': '1', 'compaction_window_unit': 'DAYS', 'max_threshold': '32', 'min_threshold': '4'}
    AND compression = {'chunk_length_in_kb': '16', 'class': 'org.apache.cassandra.io.compress.LZ4Compressor'}
    AND memtable = 'default'
    AND crc_check_chance = 1.0
    AND default_time_to_live = 7776000
    AND extensions = {}
    AND gc_grace_seconds = 864000
    AND incremental_backups = true
    AND max_index_interval = 2048
    AND memtable_flush_period_in_ms = 0
    AND min_index_interval = 128
    AND read_repair = 'BLOCKING'
    AND speculative_retry = '99p';

CREATE INDEX txn_by_currency ON payments.transactions_by_merchant (currency);

CREATE MATERIALIZED VIEW payments.transactions_by_status AS
    SELECT status, merchant_id, txn_day, txn_time, amount
    FROM payments.transactions_by_merchant
    WHERE status IS NOT NULL AND merchant_id IS NOT NULL AND txn_day IS NOT NULL AND txn_time IS NOT NULL
    PRIMARY KEY (status, merchant_id, txn_day, txn_time)
 WITH CLUSTERING ORDER BY (merchant_id ASC, txn_day ASC, txn_time DESC)
    AND additional_write_policy = '99p'
    AND allow_auto_snapshot = true
    AND bloom_filter_fp_chance = 0.01
    AND caching = {'keys': 'ALL', 'rows_per_partition': 'NONE'}
    AND cdc = false
    AND comment = ''
    AND compaction = {'class': 'org.apache.cassandra.db.compaction.SizeTieredCompactionStrategy', 'max_threshold': '32', 'min_threshold': '4'}
    AND compression = {'chunk_length_in_kb': '16', 'class': 'org.apache.cassandra.io.compress.LZ4Compressor'}
    AND memtable = 'default'
    AND crc_check_chance = 1.0
    AND extensions = {}
    AND gc_grace_seconds = 864000
    AND incremental_backups = true
    AND max_index_interval = 2048
    AND memtable_flush_period_in_ms = 0
    AND min_index_interval = 128
    AND read_repair = 'BLOCKING'
    AND speculative_retry = '99p';
