import type { ChangeResult, QueryColumn } from '../api/types'
import { cellItemId, deleteItemId, flatten, hasTruncatedKey, keyColumnsOf, keyObject, reconcile, rowKeyOf, stage, summarize, unstage } from './changes'
import type { PendingItem } from './changes'

const cols: QueryColumn[] = [
  { name: 'txn_time', type: { name: 'timeuuid' }, kind: 'clustering', position: 1 },
  { name: 'status', type: { name: 'text' }, kind: 'regular' },
  { name: 'txn_day', type: { name: 'date' }, kind: 'partition', position: 2 },
  { name: 'merchant_id', type: { name: 'uuid' }, kind: 'partition', position: 1 },
]
const row = ['t1', 'ok', '2026-09-30', 'm1']

const cell = (rowKey: string, column: string, kind: 'set_cell' | 'set_null' = 'set_cell'): PendingItem => ({
  id: cellItemId(rowKey, column),
  type: 'cell',
  rowKey,
  column,
  draft: 'x',
  changes: [{ kind, column }],
})

describe('row keys', () => {
  it('orders key columns: partition by position, then clustering', () => {
    expect(keyColumnsOf(cols).map((c) => c.name)).toEqual(['merchant_id', 'txn_day', 'txn_time'])
  })
  it('builds a row key and key object from a positional row', () => {
    expect(rowKeyOf(cols, row)).toBe('["m1","2026-09-30","t1"]')
    expect(keyObject(cols, row)).toEqual({ merchant_id: 'm1', txn_day: '2026-09-30', txn_time: 't1' })
  })
  it('flags a truncated blob in the key', () => {
    const blobCols: QueryColumn[] = [{ name: 'k', type: { name: 'blob' }, kind: 'partition', position: 1 }]
    expect(hasTruncatedKey(blobCols, [{ $truncated: true, preview: '0x00', bytes: 99999 }])).toBe(true)
    expect(hasTruncatedKey(blobCols, ['0x00'])).toBe(false)
  })
})

describe('staging', () => {
  it('replaces an edited cell in place and keeps its position', () => {
    let items = stage([], cell('r1', 'a'))
    items = stage(items, cell('r1', 'b'))
    items = stage(items, { ...cell('r1', 'a', 'set_null'), draft: null })
    expect(items.map((i) => i.column)).toEqual(['a', 'b'])
    expect(items[0].changes[0].kind).toBe('set_null')
  })
  it('drops a row’s cell edits when the row is deleted and ignores later edits to it', () => {
    let items = stage(stage([], cell('r1', 'a')), cell('r2', 'a'))
    items = stage(items, { id: deleteItemId('r1'), type: 'delete', rowKey: 'r1', changes: [{ kind: 'delete_row' }] })
    expect(items.map((i) => i.id)).toEqual([cellItemId('r2', 'a'), deleteItemId('r1')])
    expect(stage(items, cell('r1', 'b'))).toBe(items)
  })
  it('un-stages one item', () => {
    const items = stage(stage([], cell('r1', 'a')), cell('r1', 'b'))
    expect(unstage(items, cellItemId('r1', 'a')).map((i) => i.column)).toEqual(['b'])
  })
  it('summarises kinds', () => {
    const items: PendingItem[] = [
      { id: 'i', type: 'insert', changes: [{ kind: 'insert_row' }] },
      cell('r', 'a'),
      cell('r', 'b'),
      { id: deleteItemId('z'), type: 'delete', rowKey: 'z', changes: [{ kind: 'delete_row' }] },
    ]
    expect(summarize(items)).toBe('1 insert, 2 updates, 1 delete')
    expect(summarize([cell('r', 'a')])).toBe('1 update')
    expect(summarize([])).toBe('')
  })
})

describe('reconcile', () => {
  const two: PendingItem = { ...cell('r1', 'tags'), changes: [{ kind: 'set_remove' }, { kind: 'set_add' }] }
  const items: PendingItem[] = [cell('r1', 'a'), two, cell('r2', 'b')]
  const res = (statuses: ChangeResult['status'][], error?: string): ChangeResult[] =>
    statuses.map((status, index) => ({ index, status, executed_cql: '', error: status === 'failed' ? { code: 'query_failed', message: error ?? 'boom' } : undefined }))

  it('flattens statements in order', () => {
    expect(flatten(items).map((f) => f.change.kind)).toEqual(['set_cell', 'set_remove', 'set_add', 'set_cell'])
  })
  it('removes applied items and keeps the failed and later ones', () => {
    const out = reconcile(items, res(['applied', 'applied', 'failed', 'pending'], 'write timeout'))
    expect(out.items.map((i) => [i.column, i.changes.length])).toEqual([['tags', 1], ['b', 1]])
    expect(out.items[0].changes[0].kind).toBe('set_add')
    expect(out.errors).toEqual({ [cellItemId('r1', 'tags')]: 'write timeout' })
  })
  it('clears everything when all apply', () => {
    const out = reconcile(items, res(['applied', 'applied', 'applied', 'applied']))
    expect(out.items).toEqual([])
    expect(out.errors).toEqual({})
  })
})
