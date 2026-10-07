import { describe, expect, it } from 'vitest'
import { buildViewMap, columnRange, compareValues, describeFilter, filterOps, matchesFilter, parseDecimal, sortable, validateFilter } from './columnView'
import type { Filter, ViewInput } from './columnView'

const sortBy = (type: string, vals: unknown[], dir: 'asc' | 'desc' = 'asc') =>
  buildViewMap({
    count: vals.length,
    pinned: () => false,
    typeOf: () => type,
    wire: (i) => vals[i],
    display: (i) => (vals[i] === null ? null : String(vals[i])),
    sort: { column: 'c', dir },
    filters: {},
  }).map((i) => vals[i])

describe('sortable', () => {
  it('rejects collections, UDTs and duration', () => {
    for (const t of ['list<int>', 'map<text, int>', 'frozen<tuple<int, int>>', 'address', 'duration']) expect(sortable(t)).toBe(false)
    for (const t of ['bigint', 'text', 'timeuuid', 'blob', 'boolean']) expect(sortable(t)).toBe(true)
  })
})

describe('compareValues and sorting', () => {
  it('orders bigints numerically with NULL last in both directions', () => {
    expect(sortBy('bigint', ['100', null, '9', '10'])).toEqual(['9', '10', '100', null])
    expect(sortBy('bigint', ['100', null, '9', '10'], 'desc')).toEqual(['100', '10', '9', null])
  })
  it('is exact for huge integers and decimals', () => {
    expect(compareValues('varint', '9007199254740993', '9007199254740992')).toBe(1)
    expect(compareValues('decimal', '1.10', '1.1')).toBe(0)
    expect(compareValues('decimal', '2', '1.999')).toBe(1)
  })
  it('puts NaN after numbers and before NULL', () => {
    expect(sortBy('double', [null, 'NaN', 2, 1])).toEqual([1, 2, 'NaN', null])
    expect(sortBy('double', [null, 'NaN', 2, 1], 'desc')).toEqual([2, 1, 'NaN', null])
  })
  it('orders text by code point, not UTF-16 unit', () => {
    expect(sortBy('text', ['\u{1F600}', '～', 'a'])).toEqual(['a', '～', '\u{1F600}'])
  })
  it('orders booleans, times, uuids, inet and blobs', () => {
    expect(sortBy('boolean', [true, false])).toEqual([false, true])
    expect(sortBy('timestamp', ['2026-10-06T10:00:00Z', '2025-01-01T00:00:00Z'])).toEqual(['2025-01-01T00:00:00Z', '2026-10-06T10:00:00Z'])
    expect(sortBy('time', ['10:00:00', '9:30:00.5'])).toEqual(['9:30:00.5', '10:00:00'])
    const early = '00000000-0000-1000-8000-000000000001'
    const late = 'ffffffff-0000-1000-8000-000000000000'
    expect(sortBy('timeuuid', [late, early])).toEqual([early, late])
    expect(sortBy('inet', ['::1', '10.0.0.2', '9.0.0.1'])).toEqual(['9.0.0.1', '10.0.0.2', '::1'])
    expect(sortBy('blob', ['0x0aff', '0x01'])).toEqual(['0x01', '0x0aff'])
  })
  it('is stable for ties', () => {
    const vals = [{ k: 1 }, { k: 1 }, { k: 1 }]
    const order = buildViewMap({ count: 3, pinned: () => false, typeOf: () => 'int', wire: (i) => vals[i].k, display: () => '1', sort: { column: 'c', dir: 'desc' }, filters: {} })
    expect(order).toEqual([0, 1, 2])
  })
})

describe('filters', () => {
  const f = (op: Filter['op'], value?: string, value2?: string, matchCase?: boolean): Filter => ({ op, value, value2, matchCase })
  it('matches text operators, case-insensitive by default', () => {
    expect(matchesFilter('text', f('contains', 'ELL'), 'hello', 'hello')).toBe(true)
    expect(matchesFilter('text', f('contains', 'ELL', undefined, true), 'hello', 'hello')).toBe(false)
    expect(matchesFilter('text', f('starts', 'he'), 'hello', 'hello')).toBe(true)
    expect(matchesFilter('text', f('ends', 'lo'), 'hello', 'hello')).toBe(true)
    expect(matchesFilter('text', f('neq', 'hello'), 'hello', 'hello')).toBe(false)
    expect(matchesFilter('text', f('ncontains', 'z'), 'hello', 'hello')).toBe(true)
  })
  it('matches numeric operators and between inclusively', () => {
    expect(matchesFilter('int', f('gt', '100'), 101, '101')).toBe(true)
    expect(matchesFilter('int', f('gt', '100'), 100, '100')).toBe(false)
    expect(matchesFilter('int', f('between', '1', '5'), 5, '5')).toBe(true)
    expect(matchesFilter('int', f('between', '1', '5'), 6, '6')).toBe(false)
    expect(matchesFilter('double', f('ge', '1.5'), 'NaN', 'NaN')).toBe(false)
  })
  it('matches temporal and boolean operators', () => {
    expect(matchesFilter('timestamp', f('after', '2026-01-01'), '2026-10-06T10:00:00Z', 'x')).toBe(true)
    expect(matchesFilter('date', f('before', '2026-01-01'), '2026-10-06', 'x')).toBe(false)
    expect(matchesFilter('boolean', f('true'), true, 'true')).toBe(true)
    expect(matchesFilter('boolean', f('false'), true, 'true')).toBe(false)
  })
  it('lets NULL match only "is null"', () => {
    expect(matchesFilter('int', f('gt', '1'), null, null)).toBe(false)
    expect(matchesFilter('text', f('ncontains', 'x'), null, null)).toBe(false)
    expect(matchesFilter('int', f('null'), null, null)).toBe(true)
    expect(matchesFilter('int', f('notnull'), null, null)).toBe(false)
  })
  it('matches collections on displayed text', () => {
    expect(matchesFilter('list<int>', f('contains', '2'), [1, 2], '[1, 2]')).toBe(true)
  })
  it('offers the specified operators per type', () => {
    expect(filterOps('list<int>').map((o) => o.op)).toEqual(['contains', 'null', 'notnull'])
    expect(filterOps('duration').map((o) => o.op)).toEqual(['contains', 'null', 'notnull'])
    expect(filterOps('boolean').map((o) => o.op)).toEqual(['true', 'false', 'null', 'notnull'])
    expect(filterOps('timestamp').map((o) => o.op)).toContain('between')
  })
  it('validates numbers and ISO input', () => {
    expect(validateFilter('int', f('gt', '12'))).toBeNull()
    expect(validateFilter('int', f('gt', 'abc'))).toMatch(/number/)
    expect(validateFilter('int', f('between', '1'))).toMatch(/second/)
    expect(validateFilter('timestamp', f('after', '2026-10-06T10:00:00Z'))).toBeNull()
    expect(validateFilter('timestamp', f('after', 'yesterday'))).toMatch(/ISO/)
    expect(validateFilter('int', f('null'))).toBeNull()
  })
  it('describes a filter for the chip', () => {
    expect(describeFilter('int', f('gt', '100'))).toBe('> 100')
    expect(describeFilter('int', f('between', '1', '5'))).toBe('between 1 and 5')
  })
  it('parses decimals', () => {
    expect(parseDecimal('1e2')).toEqual({ n: 1n, scale: -2 })
    expect(parseDecimal('x')).toBeNull()
  })
})

describe('buildViewMap', () => {
  const vals = [5, 3, null, 8, 1]
  const base = (over: Partial<ViewInput>): ViewInput => ({
    count: vals.length,
    pinned: () => false,
    typeOf: () => 'int',
    wire: (i) => vals[i],
    display: (i) => (vals[i] === null ? null : String(vals[i])),
    sort: null,
    filters: {},
    ...over,
  })
  it('keeps load order with no sort or filter', () => {
    expect(buildViewMap(base({}))).toEqual([0, 1, 2, 3, 4])
  })
  it('maps display positions to source rows after sort and filter', () => {
    const m = buildViewMap(base({ sort: { column: 'c', dir: 'asc' }, filters: { c: { op: 'gt', value: '1' } } }))
    expect(m).toEqual([1, 0, 3]) // 3, 5, 8; the third visible row is source row 3
  })
  it('drops NULL rows from a > filter', () => {
    expect(buildViewMap(base({ filters: { c: { op: 'gt', value: '0' } } }))).not.toContain(2)
  })
  it('pins pending inserts at their position', () => {
    const m = buildViewMap(base({ pinned: (i) => i === 0, sort: { column: 'c', dir: 'asc' } }))
    expect(m[0]).toBe(0)
    expect(m.slice(1).map((i) => vals[i])).toEqual([1, 3, 8, null])
  })
})

describe('columnRange', () => {
  it('selects inclusively in current order', () => {
    expect(columnRange(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c'])
  })
})
