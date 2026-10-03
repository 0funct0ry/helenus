import type { QueryResponse } from '../api/types'
import { cellItemId, deleteItemId, rowKeyOf } from './changes'
import type { PendingItem } from './changes'
import { composeGrid } from './gridEdits'

const res: QueryResponse = {
  kind: 'rows',
  executed_cql: '',
  columns: [
    { name: 'id', type: { name: 'uuid' }, kind: 'partition', position: 1 },
    { name: 'amount', type: { name: 'decimal' }, kind: 'regular' },
    { name: 'tags', type: { name: 'set', args: [{ name: 'text' }] }, kind: 'regular' },
    { name: 'debits', type: { name: 'counter' }, kind: 'regular' },
  ],
  rows: [
    ['a', '1180.00', ['x'], '10'],
    ['b', '5.00', null, null],
  ],
  has_more: false,
  warnings: [],
  timing: { client_ms: 1 },
}
const keyA = rowKeyOf(res.columns, res.rows[0])
const keyB = rowKeyOf(res.columns, res.rows[1])

describe('composeGrid', () => {
  it('shows fetched rows untouched when nothing is staged', () => {
    const { rows, meta } = composeGrid(res, [])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'a', amount: '1180.00', tags: "{'x'}" })
    expect(meta.map((m) => m.kind)).toEqual(['row', 'row'])
    expect(meta[0]).toMatchObject({ source: 0, rowKey: keyA, cells: {} })
  })

  it('lays staged cell edits over their rows and remembers the old value', () => {
    const items: PendingItem[] = [
      { id: cellItemId(keyA, 'amount'), type: 'cell', rowKey: keyA, column: 'amount', draft: '1250.00', changes: [] },
      { id: cellItemId(keyB, 'tags'), type: 'cell', rowKey: keyB, column: 'tags', draft: ['vip'], changes: [] },
    ]
    const { rows, meta } = composeGrid(res, items)
    expect(rows[0].amount).toBe('1250.00')
    expect(meta[0].cells.amount).toEqual({ changed: true, was: '1180.00', error: undefined })
    expect(rows[1].tags).toBe("{'vip'}")
    expect(meta[1].cells.tags.was).toBeNull()
  })

  it('shows a counter edit as the value plus the delta', () => {
    const items: PendingItem[] = [
      { id: cellItemId(keyA, 'debits'), type: 'cell', rowKey: keyA, column: 'debits', draft: '5', counter: true, changes: [] },
      { id: cellItemId(keyB, 'debits'), type: 'cell', rowKey: keyB, column: 'debits', draft: '-2', counter: true, changes: [] },
    ]
    const { rows } = composeGrid(res, items)
    expect(rows[0].debits).toBe('10 (+5)')
    expect(rows[1].debits).toBe('0 (-2)')
  })

  it('puts staged inserts first and marks deleted rows', () => {
    const items: PendingItem[] = [
      { id: 'insert:1', type: 'insert', values: { id: 'z', amount: '9.99' }, changes: [] },
      { id: deleteItemId(keyB), type: 'delete', rowKey: keyB, changes: [] },
    ]
    const { rows, meta } = composeGrid(res, items)
    expect(rows[0]).toMatchObject({ id: 'z', amount: '9.99', tags: null })
    expect(meta.map((m) => m.kind)).toEqual(['new', 'row', 'deleted'])
    expect(meta[0]).toMatchObject({ source: null, itemId: 'insert:1' })
    expect(meta[2]).toMatchObject({ source: 1, itemId: deleteItemId(keyB) })
  })

  it('carries apply errors onto the cell or row', () => {
    const cellId = cellItemId(keyA, 'amount')
    const delId = deleteItemId(keyB)
    const items: PendingItem[] = [
      { id: cellId, type: 'cell', rowKey: keyA, column: 'amount', draft: '1', changes: [] },
      { id: delId, type: 'delete', rowKey: keyB, changes: [] },
    ]
    const { meta } = composeGrid(res, items, { [cellId]: 'write timeout', [delId]: 'unavailable' })
    expect(meta[0].cells.amount.error).toBe('write timeout')
    expect(meta[1].error).toBe('unavailable')
  })

  it('locks rows whose key holds a truncated blob', () => {
    const blobRes: QueryResponse = { ...res, columns: [{ name: 'k', type: { name: 'blob' }, kind: 'partition', position: 1 }], rows: [[{ $truncated: true, preview: '0x00', bytes: 99999 }]] }
    expect(composeGrid(blobRes, []).meta[0].locked).toBe(true)
  })
})
