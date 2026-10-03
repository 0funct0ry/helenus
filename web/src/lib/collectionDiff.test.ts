import type { TypeDesc } from '../api/types'
import { collectionChanges } from './collectionDiff'

const t = (name: string, args: TypeDesc[] = [], over: Partial<TypeDesc> = {}): TypeDesc => ({ name, args, ...over })
const list = t('list', [t('text')])
const set = t('set', [t('text')])
const map = t('map', [t('text'), t('int')])
const udt: TypeDesc = { name: 'contact', udt: { keyspace: 'k', name: 'contact' } }

describe('collectionChanges', () => {
  it('emits nothing when nothing changed', () => {
    expect(collectionChanges(set, ['a'], ['a'])).toEqual([])
    expect(collectionChanges(list, null, [])).toEqual([])
  })

  describe('lists', () => {
    it('appends and prepends', () => {
      expect(collectionChanges(list, ['b'], ['b', 'c', 'd'])).toEqual([{ kind: 'list_append', value: ['c', 'd'] }])
      expect(collectionChanges(list, ['b'], ['a', 'b'])).toEqual([{ kind: 'list_prepend', value: ['a'] }])
      expect(collectionChanges(list, null, ['a'])).toEqual([{ kind: 'list_append', value: ['a'] }])
    })
    it('sets changed positions', () => {
      expect(collectionChanges(list, ['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([{ kind: 'list_set_index', index: 1, value: 'B' }])
    })
    it('removes positions from the end first so indexes stay valid', () => {
      expect(collectionChanges(list, ['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual([
        { kind: 'list_remove_index', index: 2 },
        { kind: 'list_remove_index', index: 0 },
      ])
    })
    it('writes a reordered list position by position', () => {
      expect(collectionChanges(list, ['a', 'b'], ['b', 'a'])).toEqual([
        { kind: 'list_set_index', index: 0, value: 'b' },
        { kind: 'list_set_index', index: 1, value: 'a' },
      ])
    })
    it('replaces the list when it was edited in mixed ways', () => {
      expect(collectionChanges(list, ['a', 'b'], ['a', 'x', 'y'])).toEqual([{ kind: 'replace_value', value: ['a', 'x', 'y'] }])
    })
    it('clears a list that was emptied', () => {
      expect(collectionChanges(list, ['a'], [])).toEqual([{ kind: 'set_null' }])
    })
  })

  describe('sets', () => {
    it('adds and removes members', () => {
      expect(collectionChanges(set, ['a', 'b'], ['b', 'c'])).toEqual([
        { kind: 'set_remove', value: ['a'] },
        { kind: 'set_add', value: ['c'] },
      ])
      expect(collectionChanges(set, ['a'], ['a', 'vip'])).toEqual([{ kind: 'set_add', value: ['vip'] }])
    })
  })

  describe('maps', () => {
    it('puts new and changed entries and removes missing keys', () => {
      expect(collectionChanges(map, [['a', 1], ['b', 2]], [['b', 3], ['c', 4]])).toEqual([
        { kind: 'map_remove', map_key: 'a' },
        { kind: 'map_put', map_key: 'b', value: 3 },
        { kind: 'map_put', map_key: 'c', value: 4 },
      ])
    })
  })

  describe('UDTs', () => {
    it('sets each changed field of a non-frozen UDT', () => {
      expect(collectionChanges(udt, { city: 'Pune', zip: '1' }, { city: 'Mumbai', zip: '1' })).toEqual([{ kind: 'udt_field_set', field: 'city', value: 'Mumbai' }])
      expect(collectionChanges(udt, null, { city: 'Pune' })).toEqual([{ kind: 'udt_field_set', field: 'city', value: 'Pune' }])
    })
  })

  describe('whole-value replacement', () => {
    it('replaces frozen collections, frozen UDTs, tuples and vectors', () => {
      expect(collectionChanges(t('set', [t('text')], { frozen: true }), ['a'], ['a', 'b'])).toEqual([{ kind: 'replace_value', value: ['a', 'b'] }])
      expect(collectionChanges({ ...udt, frozen: true }, { city: 'a' }, { city: 'b' })).toEqual([{ kind: 'replace_value', value: { city: 'b' } }])
      expect(collectionChanges(t('tuple', [t('int'), t('int')]), [1, 2], [1, 3])).toEqual([{ kind: 'replace_value', value: [1, 3] }])
      expect(collectionChanges(t('vector', [t('float')], { size: 2 }), [1, 2], [1, 3])).toEqual([{ kind: 'replace_value', value: [1, 3] }])
    })
    it('keeps an emptied frozen collection as a value, not null', () => {
      expect(collectionChanges(t('list', [t('text')], { frozen: true }), ['a'], [])).toEqual([{ kind: 'replace_value', value: [] }])
    })
  })
})
