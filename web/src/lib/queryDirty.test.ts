import { isDirtyTab } from './queryDirty'

describe('isDirtyTab', () => {
  const bound = { kind: 'query' as const, savedQueryId: 1 }
  it('is dirty when text differs from the saved text', () => expect(isDirtyTab(bound, { text: 'b', savedText: 'a' })).toBe(true))
  it('is clean when equal', () => expect(isDirtyTab(bound, { text: 'a', savedText: 'a' })).toBe(false))
  it('is never dirty when unbound', () => expect(isDirtyTab({ kind: 'query' }, { text: 'b', savedText: 'a' })).toBe(false))
  it('ignores non-query tabs and missing state', () => {
    expect(isDirtyTab({ kind: 'table', savedQueryId: 1 }, { text: 'b', savedText: 'a' })).toBe(false)
    expect(isDirtyTab(bound, undefined)).toBe(false)
  })
})
