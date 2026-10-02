import { formatCell, timeuuidTime, typeToCql } from './cellFormat'

const text = { name: 'text' }

describe('typeToCql', () => {
  it('renders nested, frozen, udt and vector types', () => {
    expect(typeToCql({ name: 'map', args: [text, { name: 'list', args: [{ name: 'int' }], frozen: true }] })).toBe('map<text, frozen<list<int>>>')
    expect(typeToCql({ name: 'udt', udt: { keyspace: 'k', name: 'address' }, frozen: true })).toBe('frozen<address>')
    expect(typeToCql({ name: 'vector', args: [{ name: 'float' }], size: 3 })).toBe('vector<float, 3>')
  })
})

describe('formatCell', () => {
  it('maps null to null and shows scalars bare', () => {
    expect(formatCell(text, null)).toBeNull()
    expect(formatCell(text, 'hi')).toBe('hi')
    expect(formatCell({ name: 'bigint' }, '9007199254740993')).toBe('9007199254740993')
    expect(formatCell({ name: 'boolean' }, true)).toBe('true')
  })
  it('renders collections as CQL literals', () => {
    expect(formatCell({ name: 'set', args: [text] }, ['a', "b'c"])).toBe("{'a', 'b''c'}")
    expect(formatCell({ name: 'list', args: [{ name: 'int' }] }, [1, 2])).toBe('[1, 2]')
    expect(formatCell({ name: 'map', args: [text, { name: 'int' }] }, [['k', 1]])).toBe("{'k': 1}")
    expect(formatCell({ name: 'tuple', args: [text, { name: 'int' }] }, ['a', 1])).toBe("('a', 1)")
    expect(formatCell({ name: 'timestamp' }, '2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00Z')
    expect(formatCell({ name: 'set', args: [{ name: 'uuid' }] }, ['7c9e6679-7425-40de-944b-e07fc1f90ae7'])).toBe('{7c9e6679-7425-40de-944b-e07fc1f90ae7}')
  })
  it('renders UDTs as {field: value}', () => {
    expect(formatCell({ name: 'udt', udt: { keyspace: 'k', name: 'a' } }, { street: '12 Quay', zip: null })).toBe("{street: '12 Quay', zip: null}")
  })
  it('previews blobs with their length', () => {
    expect(formatCell({ name: 'blob' }, '0xdeadbeef')).toBe('0xdeadbeef (4 B)')
    expect(formatCell({ name: 'blob' }, { $truncated: true, preview: '0x0102', bytes: 5000 })).toBe('0x0102… (5000 B)')
  })
})

describe('timeuuidTime', () => {
  it('extracts the embedded time of a v1 uuid', () => {
    expect(timeuuidTime('d9f2a1c0-9c9d-11f1-8b3a-0242ac120002')).toMatch(/^20\d\d-/)
    expect(timeuuidTime('13814000-1dd2-11b2-8000-000000000000')).toBe('1970-01-01T00:00:00.000Z')
  })
  it('is undefined for non-v1 ids', () => {
    expect(timeuuidTime('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBeUndefined()
  })
})
