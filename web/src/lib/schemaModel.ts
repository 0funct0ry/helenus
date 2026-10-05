/** The schema shapes the explorer components render, built from the API snapshot (see api/schema.ts). */
import type { TypeDesc } from '../api/types'

export type ColumnKind = 'partition' | 'clustering' | 'static' | 'regular'

export interface Column {
  name: string
  type: string
  kind: ColumnKind
  /** 1-based position within the partition or clustering key. */
  position?: number
  order?: 'ASC' | 'DESC'
  /** The structured type, used by the cell and collection editors. */
  desc?: TypeDesc
}

export interface Index {
  name: string
  column: string
  kind: string
  /** Raw target as stored, e.g. `values(tags)` or `email`. */
  target?: string
  /** Short badge text: SAI, 2i or custom. */
  badge?: 'SAI' | '2i' | 'custom'
  options?: Record<string, string>
}

export interface Trigger {
  name: string
  table: string
  /** The Java class that implements the trigger. */
  class: string
}

export interface Table {
  name: string
  keyspace: string
  columns: Column[]
  options: Record<string, string>
  indexes: Index[]
  triggers?: Trigger[]
  views: string[]
  counter?: boolean
}

export interface MaterializedView {
  name: string
  keyspace: string
  baseTable: string
  columns: Column[]
  filter: string
  options?: Record<string, string>
}

export interface Udt {
  name: string
  keyspace: string
  fields: { name: string; type: string; desc?: TypeDesc }[]
  usedBy: string[]
}

/** A user-defined function; `signature` is `name(argtypes)` and identifies one overload. */
export interface Fn {
  keyspace: string
  name: string
  signature: string
  argNames: string[]
  argTypes: string[]
  returnType: string
  language: string
  body: string
  calledOnNull: boolean
}

/** A user-defined aggregate; `signature` is `name(argtypes)` and identifies one overload. */
export interface Agg {
  keyspace: string
  name: string
  signature: string
  argTypes: string[]
  stateFunc: string
  stateType: string
  finalFunc: string
  initCond: string
  returnType: string
}

export interface Keyspace {
  name: string
  replication: string
  system?: boolean
  tables: Table[]
  views: MaterializedView[]
  types: Udt[]
  functions: Fn[]
  aggregates: Agg[]
  /** Every trigger on the keyspace's tables. */
  triggers?: Trigger[]
}

export type ProfileStatus = 'connected' | 'connecting' | 'error'
