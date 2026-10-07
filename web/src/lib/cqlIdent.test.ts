import { expect, it } from 'vitest'
import { quoteIdent } from './cqlIdent'

it('quotes only when CQL requires it', () => {
  expect(quoteIdent('id')).toBe('id')
  expect(quoteIdent('Name')).toBe('"Name"')
  expect(quoteIdent('select')).toBe('"select"')
  expect(quoteIdent('1a')).toBe('"1a"')
  expect(quoteIdent('a"b')).toBe('"a""b"')
})
