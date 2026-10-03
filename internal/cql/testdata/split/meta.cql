.use ks
.consistency QUORUM;
SELECT 1;
.describe TABLE t
.expand ON
.alias foo = bar
.source 'a;b.cql'
