import { cqlToDraft, draftToCql, newDraft, toTypeDesc } from './typeBuilder'
import type { TypeDraft } from './typeBuilder'

const d = (base: string, over: Partial<TypeDraft> = {}): TypeDraft => ({ ...newDraft(base), ...over })

describe('typeBuilder', () => {
  it('builds slots for each shape', () => {
    expect(newDraft('text').args).toHaveLength(0)
    expect(newDraft('list').args).toHaveLength(1)
    expect(newDraft('map').args).toHaveLength(2)
    expect(newDraft('tuple').args).toHaveLength(2)
    expect(newDraft('vector')).toMatchObject({ size: 3 })
  })
  it('converts to a descriptor', () => {
    const map = d('map', { frozen: true, args: [d('text'), d('udt:address')] })
    expect(toTypeDesc(map, 'payments')).toEqual({
      name: 'map',
      frozen: true,
      args: [{ name: 'text' }, { name: 'address', udt: { keyspace: 'payments', name: 'address' } }],
    })
    expect(toTypeDesc(d('vector', { args: [d('float')], size: 4 }), 'k')).toEqual({ name: 'vector', args: [{ name: 'float' }], size: 4 })
  })
  it('renders CQL', () => {
    expect(draftToCql(d('set', { frozen: true, args: [d('int')] }))).toBe('frozen<set<int>>')
    expect(draftToCql(d('vector', { args: [d('float')], size: 3 }))).toBe('vector<float, 3>')
    expect(draftToCql(d('udt:address'))).toBe('address')
  })
})

describe('cqlToDraft', () => {
  it('round-trips scalars, collections, vectors and UDTs', () => {
    for (const cql of ['int', 'frozen<list<int>>', 'map<text, frozen<set<uuid>>>', 'tuple<int, text>', 'vector<float, 3>', 'frozen<address>']) {
      expect(draftToCql(cqlToDraft(cql))).toBe(cql)
    }
  })
  it('treats unknown names as UDTs', () => {
    expect(cqlToDraft('address').base).toBe('udt:address')
  })
})
