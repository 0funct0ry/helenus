import type { QueryResponse } from '../api/types'
import type { Row } from '../mocks/types'
import { formatCell } from './cellFormat'
import { hasTruncatedKey, rowKeyOf } from './changes'
import type { PendingItem } from './changes'
import { toGridRows } from './rows'

/** What the grid needs to know about one cell that has a staged edit. */
export interface CellMeta {
  /** Shown highlighted, with `was` as the tooltip. */
  changed?: boolean
  was?: string | null
  /** The error from the last failed apply. */
  error?: string
}

/** What the grid needs to know about one displayed row. */
export interface RowMeta {
  /** `new` rows are staged inserts (shown first); `deleted` rows are struck through until applied. */
  kind: 'row' | 'new' | 'deleted'
  /** Index into the response rows; null for staged inserts. */
  source: number | null
  /** Identifies the row by primary key; set for rows that came from the server. */
  rowKey?: string
  /** The staged insert or delete this row shows. */
  itemId?: string
  /** True when the key cannot be echoed back (a truncated blob), so the row cannot be edited. */
  locked?: boolean
  error?: string
  cells: Record<string, CellMeta>
}

const signed = (delta: string) => (delta.startsWith('-') || delta.startsWith('+') ? delta : `+${delta}`)

/**
 * The rows the Data grid shows: staged inserts first, then the fetched rows with staged cell edits laid
 * over them. Counter edits show the current value with the delta in brackets.
 */
export function composeGrid(res: QueryResponse, items: PendingItem[], errors: Record<string, string> = {}): { rows: Row[]; meta: RowMeta[] } {
  const base = toGridRows(res)
  const rows: Row[] = []
  const meta: RowMeta[] = []

  for (const it of items.filter((i) => i.type === 'insert')) {
    rows.push(Object.fromEntries(res.columns.map((c) => [c.name, formatCell(c.type, it.values?.[c.name] ?? null)])))
    meta.push({ kind: 'new', source: null, itemId: it.id, error: errors[it.id], cells: {} })
  }

  const deletes = new Map(items.filter((i) => i.type === 'delete').map((i) => [i.rowKey, i]))
  const cellItems = items.filter((i) => i.type === 'cell')
  res.rows.forEach((raw, i) => {
    const rowKey = rowKeyOf(res.columns, raw)
    const row = { ...base[i] }
    const cells: Record<string, CellMeta> = {}
    for (const it of cellItems.filter((c) => c.rowKey === rowKey && c.column)) {
      const col = res.columns.find((c) => c.name === it.column)
      if (!col) continue
      const shown = base[i][col.name]
      const was = shown === null || shown === undefined ? null : String(shown)
      row[col.name] = it.counter ? `${was ?? '0'} (${signed(String(it.draft))})` : formatCell(col.type, it.draft)
      cells[col.name] = { changed: true, was, error: errors[it.id] }
    }
    const del = deletes.get(rowKey)
    rows.push(row)
    meta.push({
      kind: del ? 'deleted' : 'row',
      source: i,
      rowKey,
      itemId: del?.id,
      locked: hasTruncatedKey(res.columns, raw),
      error: del ? errors[del.id] : undefined,
      cells,
    })
  })
  return { rows, meta }
}
