/** The schema shapes the explorer components render, built from the API snapshot (see api/schema.ts). */
export type ColumnKind = 'partition' | 'clustering' | 'static' | 'regular'

export interface Column {
  name: string
  type: string
  kind: ColumnKind
  /** 1-based position within the partition or clustering key. */
  position?: number
  order?: 'ASC' | 'DESC'
}

export interface Index {
  name: string
  column: string
  kind: string
}

export interface Table {
  name: string
  keyspace: string
  columns: Column[]
  options: Record<string, string>
  indexes: Index[]
  views: string[]
  counter?: boolean
}

export interface MaterializedView {
  name: string
  keyspace: string
  baseTable: string
  columns: Column[]
  filter: string
}

export interface Udt {
  name: string
  keyspace: string
  fields: { name: string; type: string }[]
  usedBy: string[]
}

export interface Keyspace {
  name: string
  replication: string
  system?: boolean
  tables: Table[]
  views: MaterializedView[]
  types: Udt[]
  functions: string[]
}

export type ProfileStatus = 'connected' | 'connecting' | 'error'
