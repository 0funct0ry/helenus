const RESERVED = new Set(
  `add allow alter and apply asc authorize batch begin by columnfamily create delete desc describe drop entries execute from full grant if in index infinity insert into is keyspace limit materialized modify nan norecursive not null of on or orderby primary rename replace revoke schema select set table to token truncate unlogged update use using view where with`.split(/\s+/),
)

/** Quotes a CQL identifier only when required: reserved word, uppercase, other characters, or a leading digit (mirrors internal/cql.QuoteIdent). */
export function quoteIdent(id: string): string {
  if (id !== '' && !RESERVED.has(id) && /^[a-z_][a-z0-9_]*$/.test(id)) return id
  return `"${id.replace(/"/g, '""')}"`
}
