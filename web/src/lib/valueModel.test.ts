import type { TypeDesc } from '../api/types'
import { canonical, childType, getAt, isComposite, isMultiCell, newValue, setAt, sortSet, typeAt } from './valueModel'
import type { UdtFields } from './valueModel'

const t = (name: string, args?: TypeDesc[], over: Partial<TypeDesc> = {}): TypeDesc => ({ name, args, ...over })
const addr: TypeDesc = { name: 'address', udt: { keyspace: 'k', name: 'address' } }
const udt: UdtFields = (r) => (r.name === 'address' ? [{ name: 'city', type: t('text') }, { name: 'zip', type: t('bigint') }] : undefined)

describe('valueModel', () => {
  it('classifies types', () => {
    expect(isComposite(t('set', [t('int')]))).toBe(true)
    expect(isComposite(t('int'))).toBe(false)
    expect(isMultiCell(t('set', [t('int')]))).toBe(true)
    expect(isMultiCell(t('set', [t('int')], { frozen: true }))).toBe(false)
    expect(isMultiCell(addr)).toBe(true)
    expect(isMultiCell(t('tuple', [t('int')]))).toBe(false)
  })
  it('compares values regardless of key order', () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonical({ a: [1, { c: 3, d: 2 }], b: 1 }))
    expect(canonical(null)).toBe('null')
  })
  it('starts new elements empty', () => {
    expect(newValue(t('text'))).toBe('')
    expect(newValue(t('int'))).toBeNull()
    expect(newValue(t('boolean'))).toBe(false)
    expect(newValue(t('list', [t('int')]))).toEqual([])
    expect(newValue(t('tuple', [t('int'), t('text')]))).toEqual([null, null])
    expect(newValue(addr, udt)).toEqual({ city: null, zip: null })
  })
  it('reads and writes nested values immutably', () => {
    const root = { a: [{ b: 1 }, { b: 2 }] }
    const next = setAt(root, ['a', 1, 'b'], 9) as typeof root
    expect(getAt(next, ['a', 1, 'b'])).toBe(9)
    expect(root.a[1].b).toBe(2)
    expect(setAt(root, [], 5)).toBe(5)
  })
  it('follows drill steps through types', () => {
    const map = t('map', [t('text'), t('list', [addr], { frozen: true })])
    expect(childType(map, [0, 0]).name).toBe('text')
    expect(childType(map, [0, 1]).name).toBe('list')
    expect(typeAt(map, [{ steps: [0, 1], label: 'v' }, { steps: [2], label: '[2]' }]).udt?.name).toBe('address')
    expect(typeAt(map, [{ steps: [0, 1], label: 'v' }, { steps: [2], label: '[2]' }, { steps: ['zip'], label: 'zip' }], udt).name).toBe('bigint')
    expect(childType(addr, ['zip'], udt).name).toBe('bigint')
    expect(childType(t('tuple', [t('int'), t('text')]), [1]).name).toBe('text')
  })
  it('sorts set elements by value', () => {
    expect(sortSet(t('set', [t('int')]), [10, 9, 100])).toEqual([9, 10, 100])
    expect(sortSet(t('set', [t('bigint')]), ['10', '9', '100'])).toEqual(['9', '10', '100'])
    expect(sortSet(t('set', [t('text')]), ['b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
