import type { QueryColumn } from '../api/types'
import type { Column } from './schemaModel'

export interface Editability {
  editable: boolean
  /** Why editing is off, shown to the user. */
  reason?: string
}

/**
 * Whether the Data grid can be edited (SPEC §9.9): not for materialized views, system keyspaces, or a
 * result that lacks any primary key column, since rows could not be addressed.
 */
export function editability(opts: { isView: boolean; system: boolean; tableColumns: Column[]; result?: QueryColumn[] }): Editability {
  if (opts.isView) return { editable: false, reason: 'Materialized views are read-only. Edit the base table instead.' }
  if (opts.system) return { editable: false, reason: 'Tables in system keyspaces are read-only.' }
  if (opts.result) {
    const have = new Set(opts.result.map((c) => c.name))
    const missing = opts.tableColumns.filter((c) => (c.kind === 'partition' || c.kind === 'clustering') && !have.has(c.name))
    if (missing.length) return { editable: false, reason: `This result is missing primary key column ${missing.map((c) => c.name).join(', ')}, so rows cannot be addressed.` }
  }
  return { editable: true }
}
