import { byteOffset, charIndex, hasIf, isSelect, statementAt, textHasIf, textHasRead, toCount } from './statements'
import type { SplitStatement } from '../api/types'

const st = (start: number, end: number): SplitStatement => ({ text: 'x', start, end, line: 1, complete: true })

describe('offsets', () => {
  it('converts between UTF-16 indices and UTF-8 bytes', () => {
    expect(byteOffset('héllo', 3)).toBe(4)
    expect(charIndex('héllo', 4)).toBe(3)
  })
})

describe('statementAt', () => {
  const list = [st(0, 10), st(12, 20)]
  it('picks the containing statement', () => {
    expect(statementAt(list, 5)).toBe(list[0])
    expect(statementAt(list, 15)).toBe(list[1])
  })
  it('falls back to the one before, then the first', () => {
    expect(statementAt(list, 11)).toBe(list[0])
    expect(statementAt(list, 40)).toBe(list[1])
    expect(statementAt([st(5, 9)], 1)).toBeDefined()
    expect(statementAt([], 1)).toBeUndefined()
  })
})

describe('statement classification', () => {
  it('detects selects, skipping comments', () => {
    expect(isSelect('-- hi\nSELECT * FROM t')).toBe(true)
    expect(isSelect('INSERT INTO t (a) VALUES (1)')).toBe(false)
  })
  it('detects lightweight transactions and ignores IF in strings', () => {
    expect(hasIf('INSERT INTO t (a) VALUES (1) IF NOT EXISTS')).toBe(true)
    expect(hasIf("INSERT INTO t (a) VALUES ('if')")).toBe(false)
    expect(textHasIf("SELECT 1; UPDATE t SET a=1 WHERE k=1 IF a=0;")).toBe(true)
    expect(textHasIf('SELECT * FROM t;')).toBe(false)
    expect(textHasRead('USE ks; select * from t')).toBe(true)
    expect(textHasRead('USE ks;')).toBe(false)
  })
  it('rewrites a select as a count', () => {
    expect(toCount('SELECT a, b FROM ks.t WHERE k = 1 LIMIT 50;')).toBe('SELECT COUNT(*) FROM ks.t WHERE k = 1;')
    expect(toCount('SELECT * FROM ks.t ORDER BY c DESC LIMIT 5 ALLOW FILTERING')).toBe('SELECT COUNT(*) FROM ks.t;')
    expect(toCount('INSERT INTO t (a) VALUES (1)')).toBeUndefined()
  })
})
