import { rowsToTsv, rowToJson, toGridColumns, toGridRows } from './rows'
import { rowsResponse } from '../test/schemaFixture'

describe('rows helpers', () => {
  const res = rowsResponse()
  it('converts columns, treating unkeyed ones as regular', () => {
    expect(toGridColumns([{ name: 'k', type: { name: 'uuid' }, kind: 'partition', position: 1 }, { name: 'count', type: { name: 'bigint' } }])).toEqual([
      { name: 'k', type: 'uuid', kind: 'partition', position: 1, order: undefined },
      { name: 'count', type: 'bigint', kind: 'regular', position: undefined, order: undefined },
    ])
  })
  it('converts positional rows to records with null preserved', () => {
    expect(toGridRows(res)).toEqual([{ status: 'SETTLED', amount: '49.99' }, { status: null, amount: '1180.00' }])
  })
  it('serialises a row to JSON of raw values', () => {
    expect(JSON.parse(rowToJson(res, 1))).toEqual({ status: null, amount: '1180.00' })
  })
  it('builds TSV with a header and flattened whitespace', () => {
    const cols = toGridColumns(res.columns)
    expect(rowsToTsv(cols, [{ status: 'a\tb', amount: null }])).toBe('status\tamount\na b\t')
  })
})
