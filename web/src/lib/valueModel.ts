import type { TypeDesc } from '../api/types'
import { isScalar, isTextType } from './cellInput'

/** Resolves a user-defined type's fields, in declaration order. */
export type UdtFields = (ref: { keyspace: string; name: string }) => { name: string; type: TypeDesc }[] | undefined

/** One level of drill-down inside a value: the JSON path steps to a child plus a label for the breadcrumb. */
export interface Crumb {
  steps: (string | number)[]
  label: string
}

/** True for list, set, map, tuple, vector and UDT types: values edited with a collection editor. */
export function isComposite(t: TypeDesc): boolean {
  return !isScalar(t)
}

/** True for non-frozen collections and UDTs, the only values that accept element-wise changes (SPEC §9.9). */
export function isMultiCell(t: TypeDesc): boolean {
  return !t.frozen && (['list', 'set', 'map'].includes(t.name) || !!t.udt)
}

/** A stable JSON text for comparing values: object keys are sorted. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** The value a freshly added element starts with. Scalars other than text start empty (null) and must be filled in. */
export function newValue(t: TypeDesc, udt?: UdtFields): unknown {
  if (isTextType(t)) return ''
  if (t.name === 'boolean') return false
  if (t.name === 'list' || t.name === 'set' || t.name === 'map') return []
  if (t.name === 'tuple') return (t.args ?? []).map(() => null)
  if (t.name === 'vector') return Array.from({ length: t.size ?? 0 }, () => null)
  if (t.udt) return Object.fromEntries((udt?.(t.udt) ?? []).map((f) => [f.name, null]))
  return null
}

/** Read the value at `steps` below `root`. */
export function getAt(root: unknown, steps: (string | number)[]): unknown {
  let cur = root
  for (const s of steps) cur = (cur as Record<string | number, unknown> | null | undefined)?.[s]
  return cur
}

/** Return a copy of `root` with the value at `steps` replaced. */
export function setAt(root: unknown, steps: (string | number)[], value: unknown): unknown {
  if (steps.length === 0) return value
  const [head, ...rest] = steps
  if (Array.isArray(root)) {
    const copy = [...root]
    copy[head as number] = setAt(copy[head as number], rest, value)
    return copy
  }
  const obj = { ...((root as Record<string, unknown> | null) ?? {}) }
  obj[head as string] = setAt(obj[head as string], rest, value)
  return obj
}

/**
 * The type of the child a drill step enters. Maps are stepped as `[entryIndex, 0|1]` (key or value),
 * lists, sets and vectors as an element index, tuples as an element index, UDTs as a field name.
 */
export function childType(t: TypeDesc, steps: (string | number)[], udt?: UdtFields): TypeDesc {
  const args = t.args ?? []
  if (t.name === 'map') return args[steps[1] === 0 ? 0 : 1] ?? { name: 'text' }
  if (t.name === 'tuple') return args[steps[0] as number] ?? { name: 'text' }
  if (t.name === 'list' || t.name === 'set' || t.name === 'vector') return args[0] ?? { name: 'text' }
  if (t.udt) return udt?.(t.udt)?.find((f) => f.name === steps[0])?.type ?? { name: 'text' }
  return t
}

/** The type found by following every crumb from `root`. */
export function typeAt(root: TypeDesc, path: Crumb[], udt?: UdtFields): TypeDesc {
  return path.reduce((t, c) => childType(t, c.steps, udt), root)
}

/** Sort set elements for display: numbers by value, everything else by text. */
export function sortSet(t: TypeDesc, items: unknown[]): unknown[] {
  const el = t.args?.[0]
  const numeric = el && ['tinyint', 'smallint', 'int', 'float', 'double'].includes(el.name)
  const big = el && ['bigint', 'varint', 'decimal'].includes(el.name)
  return [...items].sort((a, b) => {
    if (numeric) return Number(a) - Number(b)
    if (big) {
      try {
        const x = el.name === 'decimal' ? Number(a) - Number(b) : BigInt(String(a)) > BigInt(String(b)) ? 1 : BigInt(String(a)) < BigInt(String(b)) ? -1 : 0
        return Number(x)
      } catch {
        return 0
      }
    }
    return canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0
  })
}
