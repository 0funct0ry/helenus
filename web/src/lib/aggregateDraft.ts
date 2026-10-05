/**
 * Convert an INITCOND as Cassandra stores it (CQL text such as `0`, `(0, 0)`, `'abc'`, `[1, 2]`) into the JSON value
 * the builder edits. Returns `undefined` when it has no JSON form (UDT literals, bare identifiers); the builder then
 * starts with an empty INITCOND instead of guessing.
 */
export function initCondToJson(cql: string): unknown {
  const s = cql.trim()
  if (!s) return undefined
  const quoted = (t: string) => t.replace(/'((?:[^']|'')*)'/g, (_, x: string) => JSON.stringify(x.replace(/''/g, "'")))
  let json = quoted(s)
  if (json.startsWith('(') && json.endsWith(')')) json = `[${json.slice(1, -1)}]`
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

/** Short `name(args) → returns` label for tree rows and headings. */
export const aggregateLabel = (a: { signature: string; returnType: string }) => `${a.signature} → ${a.returnType}`
