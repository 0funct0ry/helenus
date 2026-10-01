import type { Column, Table } from '../mocks/types'

function pkClause(columns: Column[]): string {
  const pk = columns.filter((c) => c.kind === 'partition').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const ck = columns.filter((c) => c.kind === 'clustering').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const part = pk.length === 1 ? pk[0].name : `(${pk.map((c) => c.name).join(', ')})`
  return [part, ...ck.map((c) => c.name)].join(', ')
}

/** Renders CREATE TABLE text approximating Cassandra's DESCRIBE output. */
export function tableDdl(t: Table): string {
  const cols = t.columns.map((c) => `    ${c.name} ${c.type}${c.kind === 'static' ? ' STATIC' : ''}`)
  const ck = t.columns.filter((c) => c.kind === 'clustering')
  const order = ck.length ? `\n    AND CLUSTERING ORDER BY (${ck.map((c) => `${c.name} ${c.order ?? 'ASC'}`).join(', ')})` : ''
  const opts = Object.entries(t.options).map(([k, v]) => `\n    AND ${k} = ${v}`).join('')
  const idx = t.indexes.map((i) => `\n\nCREATE INDEX ${i.name} ON ${t.keyspace}.${t.name} (${i.column});`).join('')
  return `CREATE TABLE ${t.keyspace}.${t.name} (\n${cols.join(',\n')},\n    PRIMARY KEY (${pkClause(t.columns)})\n) WITH ${order ? order.trim().replace(/^AND /, '') : 'comment = \'\''}${opts};${idx}`
}
