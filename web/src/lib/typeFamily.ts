export type TypeFamily = 'uuid' | 'num' | 'counter' | 'blob' | 'time' | 'coll' | 'udt' | 'vec' | 'text' | 'bool'

const NUM = new Set(['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'varint', 'float', 'double'])
const TIME = new Set(['timestamp', 'date', 'time', 'duration'])
const TEXT = new Set(['text', 'varchar', 'ascii', 'inet'])

export function isFrozen(type: string): boolean {
  return /^frozen\s*</i.test(type.trim())
}

/** Strips one outer `frozen<...>` wrapper. */
export function unfreeze(type: string): string {
  const t = type.trim()
  const m = /^frozen\s*<(.*)>$/is.exec(t)
  return m ? m[1].trim() : t
}

/** Maps a CQL type string to the colour family used by badges (SPEC 9.3). */
export function typeFamily(type: string): TypeFamily {
  const t = unfreeze(type).toLowerCase()
  if (t === 'uuid' || t === 'timeuuid') return 'uuid'
  if (NUM.has(t)) return 'num'
  if (t === 'counter') return 'counter'
  if (t === 'blob') return 'blob'
  if (TIME.has(t)) return 'time'
  if (t === 'boolean') return 'bool'
  if (TEXT.has(t)) return 'text'
  if (/^(list|set|map|tuple)\b/.test(t)) return 'coll'
  if (/^vector\b/.test(t)) return 'vec'
  return 'udt'
}
