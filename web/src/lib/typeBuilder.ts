import type { TypeDesc } from '../api/types'

/** Scalar types offered in the type picker (`counter` is not allowed inside a type). */
export const NATIVE_TYPES = [
  'ascii', 'bigint', 'blob', 'boolean', 'date', 'decimal', 'double', 'duration', 'float', 'inet', 'int',
  'smallint', 'text', 'time', 'timestamp', 'timeuuid', 'tinyint', 'uuid', 'varchar', 'varint',
]

/** Shapes that take element types. */
export const COMPOSITE_TYPES = ['list', 'set', 'map', 'tuple', 'vector'] as const

/** UDTs are picked as `udt:<name>`. */
export const UDT_PREFIX = 'udt:'

/** A type being built in the picker: a scalar, a collection/tuple/vector with nested drafts, or a UDT. */
export interface TypeDraft {
  /** A native type name, `list` | `set` | `map` | `tuple` | `vector`, or `udt:<name>`. */
  base: string
  frozen: boolean
  args: TypeDraft[]
  /** Vector dimension. */
  size: number
}

export const isComposite = (base: string) => (COMPOSITE_TYPES as readonly string[]).includes(base)

/** A new draft of `base` with its element slots filled with `text`. */
export function newDraft(base = 'text'): TypeDraft {
  const text = (): TypeDraft => ({ base: 'text', frozen: false, args: [], size: 0 })
  const args = base === 'map' ? [text(), text()] : base === 'tuple' ? [text(), text()] : base === 'list' || base === 'set' || base === 'vector' ? [text()] : []
  return { base, frozen: false, args, size: base === 'vector' ? 3 : 0 }
}

/** Convert a draft to the API's type descriptor; UDTs resolve in `keyspace`. */
export function toTypeDesc(d: TypeDraft, keyspace: string): TypeDesc {
  const out: TypeDesc = d.base.startsWith(UDT_PREFIX)
    ? { name: d.base.slice(UDT_PREFIX.length), udt: { keyspace, name: d.base.slice(UDT_PREFIX.length) } }
    : { name: d.base }
  if (d.args.length) out.args = d.args.map((a) => toTypeDesc(a, keyspace))
  if (d.base === 'vector') out.size = d.size
  if (d.frozen) out.frozen = true
  return out
}

/** Render a draft as CQL for labels. */
export function draftToCql(d: TypeDraft): string {
  const name = d.base.startsWith(UDT_PREFIX) ? d.base.slice(UDT_PREFIX.length) : d.base
  let s = name
  if (d.base === 'vector') s = `vector<${d.args[0] ? draftToCql(d.args[0]) : '?'}, ${d.size}>`
  else if (d.args.length) s = `${name}<${d.args.map(draftToCql).join(', ')}>`
  return d.frozen ? `frozen<${s}>` : s
}
