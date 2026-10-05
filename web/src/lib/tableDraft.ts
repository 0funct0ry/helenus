import { newDraft, toTypeDesc } from './typeBuilder'
import type { TypeDraft } from './typeBuilder'
import type { TableRequest } from '../api/types'

export type TtlUnit = 'seconds' | 'hours' | 'days'
export const TTL_UNITS: Record<TtlUnit, number> = { seconds: 1, hours: 3600, days: 86400 }

export const DEFAULT_COMPACTION = 'SizeTieredCompactionStrategy'
export const DEFAULT_COMPRESSION = 'LZ4Compressor'

/** One column in the wizard. `id` is stable across renames so key selections survive them. */
export interface ColumnDraft {
  id: number
  name: string
  type: TypeDraft
  static: boolean
}

export interface ClusteringDraft {
  /** Id of a ColumnDraft. */
  id: number
  order: 'ASC' | 'DESC'
}

/** Option inputs as typed; empty strings mean "server default". */
export interface OptionsDraft {
  comment: string
  ttl: string
  ttlUnit: TtlUnit
  gcGrace: string
  compaction: string
  compression: string
  bloom: string
}

export interface TableDraft {
  name: string
  ifNotExists: boolean
  columns: ColumnDraft[]
  /** Ids of ColumnDrafts, in key order. */
  partitionKey: number[]
  clustering: ClusteringDraft[]
  options: OptionsDraft
}

export const DEFAULT_OPTIONS: OptionsDraft = { comment: '', ttl: '', ttlUnit: 'seconds', gcGrace: '', compaction: DEFAULT_COMPACTION, compression: DEFAULT_COMPRESSION, bloom: '' }

let nextId = 1
export const newColumn = (name = '', base = 'text'): ColumnDraft => ({ id: nextId++, name, type: newDraft(base), static: false })

export const newTableDraft = (): TableDraft => ({
  name: '',
  ifNotExists: false,
  columns: [newColumn()],
  partitionKey: [],
  clustering: [],
  options: { ...DEFAULT_OPTIONS },
})

/** The TTL in seconds; -1 when the input is not a number so the server rejects it. */
export function ttlSeconds(o: OptionsDraft): number {
  if (o.ttl.trim() === '') return 0
  const n = Number(o.ttl) * TTL_UNITS[o.ttlUnit]
  return Number.isFinite(n) ? Math.round(n) : -1
}

const optionalNumber = (s: string): number | null => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : -1)

/** Build the API request for a draft in `keyspace`. Column order and key order are preserved. */
export function toTableRequest(keyspace: string, d: TableDraft): TableRequest {
  const name = (id: number) => d.columns.find((c) => c.id === id)?.name ?? ''
  const o = d.options
  return {
    keyspace,
    name: d.name,
    if_not_exists: d.ifNotExists,
    columns: d.columns.map((c) => ({ name: c.name, type: toTypeDesc(c.type, keyspace), static: c.static })),
    partition_key: d.partitionKey.map(name),
    clustering: d.clustering.map((c) => ({ column: name(c.id), order: c.order })),
    options: {
      comment: o.comment,
      default_ttl_seconds: ttlSeconds(o),
      gc_grace_seconds: optionalNumber(o.gcGrace),
      compaction: { class: o.compaction },
      compression: { class: o.compression },
      bloom_filter_fp_chance: optionalNumber(o.bloom),
    },
  }
}
