import type { SchemaColumn, SchemaKeyspace, SchemaSnapshot, SchemaTable } from './types'
import type { Column, Keyspace, Table } from '../lib/schemaModel'

function toColumn(c: SchemaColumn): Column {
  return { name: c.name, type: c.cql, kind: c.kind, position: c.position || undefined, order: c.order, desc: c.type }
}

const INDEX_KIND: Record<string, string> = { composites: 'Secondary index', keys: 'Secondary index', custom: 'Custom index' }

function toTable(t: SchemaTable): Table {
  return {
    name: t.name,
    keyspace: t.keyspace,
    columns: t.columns.map(toColumn),
    options: Object.fromEntries(t.options.map((o) => [o.name, o.value])),
    indexes: t.indexes.map((i) => ({ name: i.name, column: i.column, kind: i.sai ? 'Storage-attached (SAI)' : (INDEX_KIND[i.kind] ?? i.kind) })),
    triggers: (t.triggers ?? []).map((g) => ({ name: g.name, table: t.name, class: g.class })),
    views: t.views,
    counter: t.counter || undefined,
  }
}

/** `NTS · dc1:3, dc2:3` / `Simple · 1`, shown beside a keyspace in the tree. */
export function replicationSummary(r: Record<string, string> = {}): string {
  const cls = (r.class ?? '').split('.').pop() ?? ''
  const rest = Object.entries(r).filter(([k]) => k !== 'class' && k !== 'replication_factor')
  if (cls === 'NetworkTopologyStrategy') return `NTS · ${rest.map(([dc, n]) => `${dc}:${n}`).join(', ')}`
  if (cls === 'SimpleStrategy') return `Simple · ${r.replication_factor ?? '?'}`
  return cls.replace('Strategy', '')
}

function toKeyspace(k: SchemaKeyspace): Keyspace {
  const tables = k.tables.map(toTable)
  return {
    name: k.name,
    replication: replicationSummary(k.replication),
    system: k.system || undefined,
    tables,
    triggers: tables.flatMap((t) => t.triggers ?? []),
    views: k.views.map((v) => ({ name: v.name, keyspace: v.keyspace, baseTable: v.base_table, columns: v.columns.map(toColumn), filter: v.where_clause })),
    types: k.types.map((u) => ({ name: u.name, keyspace: u.keyspace, fields: u.fields.map((f) => ({ name: f.name, type: f.cql, desc: f.type })), usedBy: u.used_by })),
    functions: [...k.functions.map((f) => `${f.name}(${f.arg_types.join(', ')})`), ...k.aggregates.map((a) => `${a.name}(${a.arg_types.join(', ')})`)],
  }
}

/** Convert the API snapshot into the model the explorer components render. */
export function toKeyspaces(s: SchemaSnapshot): Keyspace[] {
  return s.keyspaces.map(toKeyspace)
}
