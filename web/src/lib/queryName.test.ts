import { folderOf, folderPaths, lastSegment, normalizeQueryName, queryTabTitle, validateQueryName } from './queryName'

describe('validateQueryName', () => {
  it.each([
    ['', 'Enter a name.'],
    ['   ', 'Enter a name.'],
    ['/a', 'The name cannot start or end with “/”.'],
    ['a/', 'The name cannot start or end with “/”.'],
    ['a//b', 'The name cannot have an empty folder (“//”).'],
    ['a/ /b', 'The name cannot have an empty folder (“//”).'],
    ['a\\b', 'The name cannot contain a backslash.'],
    ['a\u0007b', 'The name cannot contain control characters.'],
    ['x'.repeat(201), 'Use at most 200 characters.'],
  ])('rejects %j', (name, reason) => expect(validateQueryName(name)).toBe(reason))
  it.each(['daily', 'reports/daily payments', ' reports / daily ', 'x'.repeat(200)])('accepts %j', (n) => expect(validateQueryName(n)).toBeNull())
})

describe('name helpers', () => {
  it('normalizes segments', () => expect(normalizeQueryName(' reports / daily ')).toBe('reports/daily'))
  it('finds the last segment and folder', () => {
    expect(lastSegment('reports/2026/daily')).toBe('daily')
    expect(lastSegment('daily')).toBe('daily')
    expect(folderOf('reports/2026/daily')).toBe('reports/2026/')
    expect(folderOf('daily')).toBe('')
  })
  it('builds tab titles', () => expect(queryTabTitle('reports/daily')).toBe('daily.cql'))
  it('lists implied folders', () => expect(folderPaths(['b/x', 'a/c/d', 'a/e', 'top'])).toEqual(['a', 'a/c', 'b']))
})

describe('.cql extension', () => {
  it('is stripped so names and titles do not double it', () => {
    expect(normalizeQueryName('reports/accounts.cql')).toBe('reports/accounts')
    expect(normalizeQueryName('A.CQL')).toBe('A')
    expect(queryTabTitle(normalizeQueryName('reports/accounts.cql'))).toBe('accounts.cql')
    expect(validateQueryName('.cql')).not.toBeNull()
  })
})

describe('legacy names that already end in .cql', () => {
  it('do not double the extension in titles', () => {
    expect(queryTabTitle('reports/accounts.cql')).toBe('accounts.cql')
  })
})
