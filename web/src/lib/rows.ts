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
