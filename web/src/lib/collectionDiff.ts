import type { Change, TypeDesc } from '../api/types'
import { canonical, isMultiCell } from './valueModel'

/** A change without the row key and column, which the caller adds. */
export type ChangePart = Omit<Change, 'key' | 'column'>

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function diffList(orig: unknown[], next: unknown[]): ChangePart[] {
  if (next.length > orig.length && orig.every((v, i) => same(v, next[i]))) return [{ kind: 'list_append', value: next.slice(orig.length) }]
  const head = next.length - orig.length
  if (head > 0 && orig.every((v, i) => same(v, next[head + i]))) return [{ kind: 'list_prepend', value: next.slice(0, head) }]
  if (next.length === orig.length) {
    return next.flatMap((v, i) => (same(v, orig[i]) ? [] : [{ kind: 'list_set_index' as const, index: i, value: v }]))
  }
  if (next.length < orig.length) {
    // Removals only: walk the original and see which positions are missing from the new list.
    const removed: number[] = []
    let j = 0
    orig.forEach((v, i) => {
      if (j < next.length && same(v, next[j])) j++
      else removed.push(i)
    })
    if (j === next.length) return removed.reverse().map((index) => ({ kind: 'list_remove_index' as const, index }))
  }
  return [{ kind: 'replace_value', value: next }]
}

function diffSet(orig: unknown[], next: unknown[]): ChangePart[] {
  const had = new Set(orig.map(canonical))
  const has = new Set(next.map(canonical))
  const added = next.filter((v) => !had.has(canonical(v)))
  const removed = orig.filter((v) => !has.has(canonical(v)))
  return [...(removed.length ? [{ kind: 'set_remove' as const, value: removed }] : []), ...(added.length ? [{ kind: 'set_add' as const, value: added }] : [])]
}

function diffMap(orig: unknown[], next: unknown[]): ChangePart[] {
  const before = new Map(list(orig).map((p) => [canonical((p as unknown[])[0]), p as unknown[]]))
  const after = new Map(list(next).map((p) => [canonical((p as unknown[])[0]), p as unknown[]]))
  const out: ChangePart[] = []
  for (const [k, p] of before) if (!after.has(k)) out.push({ kind: 'map_remove', map_key: p[0] })
  for (const [k, p] of after) {
    const was = before.get(k)
    if (!was || !same(was[1], p[1])) out.push({ kind: 'map_put', map_key: p[0], value: p[1] })
  }
  return out
}

function diffUdt(orig: Record<string, unknown> | null, next: Record<string, unknown> | null): ChangePart[] {
  const a = orig ?? {}
  const b = next ?? {}
  return Object.keys({ ...a, ...b }).flatMap((f) => (same(a[f] ?? null, b[f] ?? null) ? [] : [{ kind: 'udt_field_set' as const, field: f, value: b[f] ?? null }]))
}

/**
 * Turn an edited collection or UDT into the changes that produce it from `original` (SPEC §9.9, §9.10).
 * Non-frozen values give element-wise changes (append, set index, add, put, field set, …); frozen
 * values, tuples and vectors give one whole-value replacement. A non-frozen collection emptied entirely
 * is cleared with set_null, since Cassandra stores an empty collection as null.
 */
export function collectionChanges(type: TypeDesc, original: unknown, draft: unknown): ChangePart[] {
  if (same(original, draft)) return []
  if (!isMultiCell(type)) return [{ kind: 'replace_value', value: draft }]
  if (type.udt) return diffUdt(original as Record<string, unknown> | null, draft as Record<string, unknown> | null)
  const next = list(draft)
  if (next.length === 0) return list(original).length ? [{ kind: 'set_null' }] : []
  if (type.name === 'list') return diffList(list(original), next)
  if (type.name === 'set') return diffSet(list(original), next)
  return diffMap(list(original), next)
}
