import type { QueryColumn, QueryResponse } from '../api/types'
import type { Column, Row } from '../mocks/types'
import { formatCell, typeToCql } from './cellFormat'

/** Result columns in the shape the grid renders. Unkeyed (computed) columns are regular. */
export function toGridColumns(cols: QueryColumn[]): Column[] {
  return cols.map((c) => ({ name: c.name, type: typeToCql(c.type), kind: c.kind ?? 'regular', position: c.position || undefined, order: c.order }))
}

/** Convert positional rows into name-keyed records of display strings (null stays null). */
export function toGridRows(res: Pick<QueryResponse, 'columns' | 'rows'>): Row[] {
  return res.rows.map((r) => Object.fromEntries(res.columns.map((c, i) => [c.name, formatCell(c.type, r[i])])))
}

/** One row as a JSON object of decoded values, for "Copy row as JSON". */
export function rowToJson(res: Pick<QueryResponse, 'columns' | 'rows'>, index: number): string {
  const r = res.rows[index]
  return JSON.stringify(Object.fromEntries(res.columns.map((c, i) => [c.name, r[i] ?? null])), null, 2)
}

/** Tab-separated text for the given rows (header first), for "Copy as TSV". */
export function rowsToTsv(columns: Column[], rows: Row[]): string {
  const clean = (v: string | number | boolean | null | undefined) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')
  return [columns.map((c) => c.name).join('\t'), ...rows.map((r) => columns.map((c) => clean(r[c.name])).join('\t'))].join('\n')
}
