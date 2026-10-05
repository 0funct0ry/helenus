import { cellOf, compatibleGenerators, constantFromText, errorsFor, paramValue, withParam } from './seedModel'

describe('seedModel', () => {
  it('mirrors the server compatibility rules', () => {
    expect(compatibleGenerators({ name: 'counter' })).toEqual(['int_range'])
    expect(compatibleGenerators({ name: 'uuid' })).toEqual(['constant', 'null', 'uuid', 'choice'])
    expect(compatibleGenerators({ name: 'text' })).toContain('regex')
    expect(compatibleGenerators({ name: 'inet' })).toContain('fake')
    expect(compatibleGenerators({ name: 'map', args: [{ name: 'text' }, { name: 'int' }] })).toEqual(['constant', 'null', 'collection'])
    expect(compatibleGenerators({ name: 'frozen<a>', udt: { keyspace: 'k', name: 'a' } })).toContain('composite')
  })
  it('groups field errors under a column', () => {
    const errs = [
      { field: 'columns.email', message: 'whole' },
      { field: 'columns.email.params.pattern', message: 'bad' },
      { field: 'columns.id', message: 'other' },
    ]
    expect(errorsFor(errs, 'columns.email')).toEqual({ '': 'whole', 'params.pattern': 'bad' })
  })
  it('reads numbers when they parse', () => {
    expect(paramValue('12')).toBe(12)
    expect(paramValue('1e')).toBe('1e')
    expect(paramValue('')).toBe('')
  })
  it('sets and clears parameters without mutating', () => {
    const a = { gen: 'x', params: { a: 1 } }
    expect(withParam(a, 'b', 2).params).toEqual({ a: 1, b: 2 })
    expect(withParam(a, 'a', '').params).toEqual({})
    expect(a.params).toEqual({ a: 1 })
  })
  it('parses constants by type', () => {
    expect(constantFromText('5', { name: 'int' })).toBe(5)
    expect(constantFromText('true', { name: 'boolean' })).toBe(true)
    expect(constantFromText('5', { name: 'text' })).toBe('5')
    expect(constantFromText('[1,2]', { name: 'list' })).toEqual([1, 2])
  })
  it('flattens structured preview cells', () => {
    expect(cellOf(null)).toBeNull()
    expect(cellOf(['a'])).toBe('["a"]')
    expect(cellOf(3)).toBe(3)
  })
})
