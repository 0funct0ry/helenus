import { DEFAULT_OPTIONS, ttlSeconds } from './tableDraft'
import type { OptionsDraft } from './tableDraft'
import type { Table } from './schemaModel'
import type { ViewRequest } from '../api/types'

export interface ViewClusteringDraft {
  column: string
  order: 'ASC' | 'DESC'
}

/** The New view wizard's state. Key and column entries are column names of the base table. */
export interface ViewDraft {
  name: string
  ifNotExists: boolean
  baseTable: string
  /** Select every column (`*`); unavailable when the base table has static columns. */
  allColumns: boolean
  columns: string[]
  partitionKey: string[]
  clustering: ViewClusteringDraft[]
  /** Optional raw restriction appended after the IS NOT NULL terms. */
  extraWhere: string
  options: OptionsDraft
}

const byPosition = (a: { position?: number }, b: { position?: number }) => (a.position ?? 0) - (b.position ?? 0)

/** The base table's key columns in key order: they must all stay in the view key. */
export function baseKeys(t: Table | undefined): { partition: string[]; clustering: ViewClusteringDraft[] } {
  const cols = t?.columns ?? []
  return {
    partition: cols.filter((c) => c.kind === 'partition').sort(byPosition).map((c) => c.name),
    clustering: cols.filter((c) => c.kind === 'clustering').sort(byPosition).map((c) => ({ column: c.name, order: c.order ?? 'ASC' })),
  }
}

/** A draft for a view on `base` (may be undefined until the user picks one), with its key columns pre-placed. */
export function newViewDraft(base?: Table): ViewDraft {
  const keys = baseKeys(base)
  const nonStatic = (base?.columns ?? []).filter((c) => c.kind !== 'static').map((c) => c.name)
  return {
    name: '',
    ifNotExists: false,
    baseTable: base?.name ?? '',
    allColumns: !(base?.columns ?? []).some((c) => c.kind === 'static'),
    columns: nonStatic,
    partitionKey: keys.partition,
    clustering: keys.clustering,
    extraWhere: '',
    options: { ...DEFAULT_OPTIONS },
  }
}

const optionalNumber = (s: string): number | null => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : -1)

/** Build the API request for a draft in `keyspace`. */
export function toViewRequest(keyspace: string, d: ViewDraft): ViewRequest {
  const o = d.options
  return {
    action: 'create',
    keyspace,
    name: d.name,
    base_table: d.baseTable,
    columns: d.allColumns ? ['*'] : d.columns,
    partition_key: d.partitionKey,
    clustering: d.clustering,
    extra_where: d.extraWhere,
    if_not_exists: d.ifNotExists,
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
