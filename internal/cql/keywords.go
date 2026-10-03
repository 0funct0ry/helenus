package cql

import "strings"

var keywords = map[string]bool{}
var nativeTypes = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`add aggregate all allow alter and any apply as asc ascii authorize batch begin bigint blob boolean by
		called clustering columnfamily compact contains count counter create custom date decimal delete desc describe distinct double drop
		duration each entries execute exists filtering finalfunc float from frozen full function functions grant group if in index inet
		infinity initcond input insert int into is json key keys keyspace keyspaces language limit list login map materialized modify
		nan nologin norecursive nosuperuser not null of on options or order password per permission permissions primary rename replace
		returns revoke role roles schema select set smallint static storage stype superuser table text time timestamp timeuuid tinyint
		to token trigger truncate ttl tuple type types unlogged update use user users using uuid values varchar varint view where with
		writetime`) {
		keywords[w] = true
	}
	for _, w := range strings.Fields(`ascii bigint blob boolean counter date decimal double duration float inet int smallint text time
		timestamp timeuuid tinyint uuid varchar varint list set map tuple frozen vector`) {
		nativeTypes[w] = true
	}
}

// IsKeyword reports whether w is a CQL keyword (reserved or not), ignoring case.
func IsKeyword(w string) bool { return keywords[strings.ToLower(w)] }

// IsTypeName reports whether w names a CQL native or collection type, ignoring case.
func IsTypeName(w string) bool { return nativeTypes[strings.ToLower(w)] }
