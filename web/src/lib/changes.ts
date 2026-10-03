import type { Change, ChangeResult, QueryColumn } from '../api/types'

/**
 * One staged edit in the pending bar. A `cell` item holds the statements for one cell and is replaced as
 * a unit when the cell is edited again; an `insert` is a new row; a `delete` removes a row.
 */
export interface PendingItem {
  id: string
  type: 'cell' | 'insert' | 'delete'
  /** The row the item belongs to (cell and delete items). */
  rowKey?: string
  column?: string
  /** For cells: the value to display, in the API's JSON encoding. For counters it is the delta text. */
  draft?: unknown
  counter?: boolean
  /** For inserts: the column values the new row shows. */
  values?: Record<string, unknown>
  /** Statements this item compiles to, in order. */
  changes: Change[]
}

/** The partition key columns by position, then the clustering columns by position. */
export function keyColumnsOf(columns: QueryColumn[]): QueryColumn[] {
  const at = (kind: string) => columns.filter((c) => c.kind === kind).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return [...at('partition'), ...at('clustering')]
}

/** A string identifying a row by its primary key values. */
export function rowKeyOf(columns: QueryColumn[], row: unknown[]): string {
  return JSON.stringify(keyColumnsOf(columns).map((k) => row[columns.indexOf(k)] ?? null))
}

/** The primary key values of a row by column name, ready to send as a change's `key`. */
export function keyObject(columns: QueryColumn[], row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(keyColumnsOf(columns).map((k) => [k.name, row[columns.indexOf(k)] ?? null]))
}

/** A key cell holding a truncated blob cannot be echoed back, so its row cannot be edited. */
export function hasTruncatedKey(columns: QueryColumn[], row: unknown[]): boolean {
  return keyColumnsOf(columns).some((k) => {
    const v = row[columns.indexOf(k)]
    return typeof v === 'object' && v !== null && '$truncated' in v
  })
}

export const cellItemId = (rowKey: string, column: string) => `cell:${rowKey}:${column}`
export const deleteItemId = (rowKey: string) => `delete:${rowKey}`
let insertSeq = 0
export const newInsertId = () => `insert:${++insertSeq}`

/**
 * Add an item to the pending list. An item with the same id is replaced in place, keeping its position.
 * A delete drops the row's staged cell edits, and a cell edit on a row already staged for deletion is ignored.
 */
export function stage(items: PendingItem[], item: PendingItem): PendingItem[] {
  if (item.type === 'delete') {
    const rest = items.filter((i) => !(i.type === 'cell' && i.rowKey === item.rowKey) && i.id !== item.id)
    return [...rest, item]
  }
  if (item.type === 'cell' && items.some((i) => i.type === 'delete' && i.rowKey === item.rowKey)) return items
  const at = items.findIndex((i) => i.id === item.id)
  if (at < 0) return [...items, item]
  return items.map((i, n) => (n === at ? item : i))
}

/** Remove the item with this id. */
export function unstage(items: PendingItem[], id: string): PendingItem[] {
  return items.filter((i) => i.id !== id)
}

/** Every statement in apply order, each tagged with the item it came from. */
export function flatten(items: PendingItem[]): { change: Change; itemId: string }[] {
  return items.flatMap((i) => i.changes.map((change) => ({ change, itemId: i.id })))
}

/** Counts shown in the pending bar, e.g. `1 insert, 2 updates, 1 delete`. */
export function summarize(items: PendingItem[]): string {
  const n = (type: PendingItem['type']) => items.filter((i) => i.type === type).length
  const part = (count: number, word: string) => (count ? `${count} ${word}${count === 1 ? '' : 's'}` : '')
  return [part(n('insert'), 'insert'), part(n('cell'), 'update'), part(n('delete'), 'delete')].filter(Boolean).join(', ')
}

/**
 * Fold an apply response back into the pending list: applied statements leave it, and what is left
 * (the failed statement and everything after it) stays pending. Errors are keyed by item id.
 */
export function reconcile(items: PendingItem[], results: ChangeResult[]): { items: PendingItem[]; errors: Record<string, string> } {
  const flat = flatten(items)
  const applied = new Set<Change>()
  const errors: Record<string, string> = {}
  for (const r of results) {
    const f = flat[r.index]
    if (!f) continue
    if (r.status === 'applied') applied.add(f.change)
    else if (r.status === 'failed') errors[f.itemId] = r.error?.message ?? 'The change failed'
  }
  const left = items
    .map((i) => ({ ...i, changes: i.changes.filter((c) => !applied.has(c)) }))
    .filter((i) => i.changes.length > 0)
  return { items: left, errors }
}
