package complete

import "strings"

// Static vocabularies for the completion engine (SPEC §10).

var consistencyLevels = []string{"ANY", "ONE", "TWO", "THREE", "QUORUM", "ALL", "LOCAL_QUORUM", "EACH_QUORUM", "LOCAL_ONE"}

var serialLevels = []string{"SERIAL", "LOCAL_SERIAL"}

var nativeTypes = strings.Fields(`ascii bigint blob boolean counter date decimal double duration float inet int smallint text time
	timestamp timeuuid tinyint uuid varchar varint`)

// collectionTypes are type constructors offered in a type position.
var collectionTypes = []string{"frozen", "list", "map", "set", "tuple", "vector"}

type fn struct{ name, detail string }

var builtinFunctions = []fn{
	{"now", "timeuuid"}, {"uuid", "uuid"}, {"currentTimestamp", "timestamp"}, {"currentDate", "date"},
	{"currentTime", "time"}, {"currentTimeUUID", "timeuuid"}, {"toTimestamp", "timestamp"}, {"toDate", "date"},
	{"toUnixTimestamp", "bigint"}, {"toJson", "text"}, {"fromJson", "value"}, {"token", "token"},
	{"writetime", "bigint"}, {"ttl", "int"}, {"minTimeuuid", "timeuuid"}, {"maxTimeuuid", "timeuuid"},
	{"count", "bigint"}, {"min", "aggregate"}, {"max", "aggregate"}, {"sum", "aggregate"}, {"avg", "aggregate"},
	{"blobAsText", "text"}, {"textAsBlob", "blob"}, {"cast", "type"},
}

var startKeywords = []string{"SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE", "LIST"}

// metaCommands maps each shell command to its short description. Order is display order.
var metaCommands = []struct{ name, detail string }{
	{"CONSISTENCY", "show or set the consistency level"},
	{"SERIAL CONSISTENCY", "show or set the serial consistency level"},
	{"USE", "switch the current keyspace"},
	{"DESCRIBE", "print schema definitions"},
	{"DESC", "short for DESCRIBE"},
	{"SHOW", "show version or host"},
	{"EXPAND", "one record per block"},
	{"FORMAT", "choose the output format"},
	{"PAGING", "set the page size"},
	{"TRACING", "toggle query tracing"},
	{"TIMING", "toggle query timing"},
	{"SOURCE", "run a script file"},
	{"CLEAR", "clear the screen"},
	{"HELP", "list commands"},
	{"EXIT", "leave the shell"},
	{"QUIT", "leave the shell"},
}

// slashCommands are the backslash/colon meta-commands.
var slashCommands = []struct{ name, detail string }{
	{"profile", "show or switch the connection profile"},
}

var describeTargets = []string{
	"CLUSTER", "KEYSPACES", "KEYSPACE", "TABLES", "TABLE", "TYPES", "TYPE", "MATERIALIZED VIEW", "INDEX",
	"FUNCTIONS", "FUNCTION", "AGGREGATES", "AGGREGATE", "SCHEMA", "FULL SCHEMA",
}

var tableOptions = []string{
	"CLUSTERING ORDER BY", "COMPACT STORAGE", "additional_write_policy", "bloom_filter_fp_chance", "caching", "cdc", "comment",
	"compaction", "compression", "crc_check_chance", "default_time_to_live", "gc_grace_seconds", "max_index_interval",
	"memtable", "memtable_flush_period_in_ms", "min_index_interval", "read_repair", "speculative_retry",
}

var keyspaceOptions = []string{"replication", "durable_writes"}

var replicationStrategies = []string{"'SimpleStrategy'", "'NetworkTopologyStrategy'"}

// followers lists what may follow a lone keyword.
var followers = map[string][]string{
	"ORDER": {"BY"}, "GROUP": {"BY"}, "ALLOW": {"FILTERING"}, "PER": {"PARTITION LIMIT"}, "PARTITION": {"LIMIT"},
	"IS": {"NOT NULL"}, "PRIMARY": {"KEY"}, "CLUSTERING": {"ORDER BY"}, "INSERT": {"INTO"}, "APPLY": {"BATCH"},
	"MATERIALIZED": {"VIEW"}, "FULL": {"SCHEMA"}, "UNLOGGED": {"BATCH"}, "COUNTER": {"BATCH"}, "COMPACT": {"STORAGE"},
}

// ifClause is the existence-guard keyword set after IF in DDL.
var (
	ifNotExists = []string{"IF NOT EXISTS"}
	ifExists    = []string{"IF EXISTS"}
)
