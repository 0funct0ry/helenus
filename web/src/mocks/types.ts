export type { ColumnKind, Column, Index, Table, MaterializedView, Udt, Keyspace, ProfileStatus } from '../lib/schemaModel'

export type CellValue = string | number | boolean | null
export type Row = Record<string, CellValue>

export interface TraceEvent {
  node: string
  activity: string
  elapsedUs: number
  thread: string
}

export interface Message {
  id: string
  level: 'info' | 'warning' | 'error'
  text: string
  detail?: string
}
