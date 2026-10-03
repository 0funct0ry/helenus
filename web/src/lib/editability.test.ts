import type { QueryColumn } from '../api/types'
import type { Column } from './schemaModel'
import { editability } from './editability'

const tableColumns: Column[] = [
  { name: 'id', type: 'uuid', kind: 'partition', position: 1 },
  { name: 'ts', type: 'timeuuid', kind: 'clustering', position: 1 },
  { name: 'v', type: 'text', kind: 'regular' },
]
const result = (...names: string[]): QueryColumn[] => names.map((name) => ({ name, type: { name: 'text' } }))

describe('editability', () => {
  it('allows a table whose result has every key column', () => {
    expect(editability({ isView: false, system: false, tableColumns, result: result('id', 'ts', 'v') })).toEqual({ editable: true })
  })
  it('refuses views and system keyspaces with a reason', () => {
    expect(editability({ isView: true, system: false, tableColumns })).toMatchObject({ editable: false, reason: expect.stringMatching(/Materialized views/) })
    expect(editability({ isView: false, system: true, tableColumns })).toMatchObject({ editable: false, reason: expect.stringMatching(/system keyspaces/) })
  })
  it('refuses a result missing key columns and names them', () => {
    const r = editability({ isView: false, system: false, tableColumns, result: result('id', 'v') })
    expect(r.editable).toBe(false)
    expect(r.reason).toMatch(/ts/)
  })
  it('does not check the result before it has loaded', () => {
    expect(editability({ isView: false, system: false, tableColumns }).editable).toBe(true)
  })
})
