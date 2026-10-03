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

// metaCommands lists the dot commands with their short descriptions. Order is display order.
var metaCommands = []struct{ name, detail string }{
	{"consistency", "show or set the consistency level"},
	{"serial", "show or set the serial consistency level"},
	{"use", "switch the current keyspace"},
	{"describe", "print schema definitions"},
	{"desc", "short for .describe"},
	{"tables", "list tables in the current keyspace"},
	{"views", "list materialized views in the current keyspace"},
	{"types", "list user-defined types in the current keyspace"},
	{"functions", "list user-defined functions in the current keyspace"},
	{"aggregates", "list user-defined aggregates in the current keyspace"},
	{"indexes", "list indexes in the current keyspace"},
	{"triggers", "list triggers in the current keyspace"},
	{"show", "show version, host or a trace"},
	{"expand", "one record per block"},
	{"format", "choose the output format"},
	{"paging", "set the page size"},
	{"tracing", "toggle query tracing"},
	{"timing", "toggle query timing"},
	{"source", "run a script file"},
	{"clear", "clear the screen"},
	{"cls", "short for .clear"},
	{"help", "list commands"},
	{"exit", "leave the shell"},
	{"quit", "leave the shell"},
	{"profile", "show or switch the connection profile"},
	{"alias", "list, show or define an alias"},
	{"unalias", "remove an alias"},
	{"abbrev", "list abbreviations"},
	{"set", "list or set template variables"},
	{"unset", "remove a template variable"},
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
