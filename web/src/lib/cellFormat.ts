import type { TypeDesc } from '../api/types'

const QUOTED = new Set(['text', 'varchar', 'ascii', 'inet', 'timestamp', 'date', 'time'])
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Render a type descriptor as CQL, e.g. `frozen<list<text>>`, `vector<float, 3>`. */
export function typeToCql(t: TypeDesc): string {
  let base: string
  if (t.udt) base = t.udt.name
  else if (t.name === 'vector' && t.args?.length) base = `vector<${typeToCql(t.args[0])}, ${t.size ?? '?'}>`
  else if (t.args?.length) base = `${t.name}<${t.args.map(typeToCql).join(', ')}>`
  else base = t.name
  return t.frozen ? `frozen<${base}>` : base
}

interface TruncatedBlob {
  $truncated: true
  preview: string
  bytes: number
}
const isTruncated = (v: unknown): v is TruncatedBlob => typeof v === 'object' && v !== null && '$truncated' in v

function blobText(v: unknown): string {
  if (isTruncated(v)) return `${v.preview}… (${v.bytes} B)`
  const s = String(v)
  const bytes = Math.max(0, (s.length - 2) / 2)
  return s.length > 18 ? `${s.slice(0, 18)}… (${bytes} B)` : `${s} (${bytes} B)`
}

function literal(t: TypeDesc, v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (t.name === 'blob') return isTruncated(v) ? `${v.preview}…` : String(v)
  if (t.udt) {
    const o = v as Record<string, unknown>
    const fields = Object.entries(o).map(([k, x]) => `${k}: ${literal({ name: 'text' }, x)}`)
    return `{${fields.join(', ')}}`
  }
  if (t.name === 'list' || t.name === 'vector') return `[${(v as unknown[]).map((x) => literal(t.args?.[0] ?? { name: 'text' }, x)).join(', ')}]`
  if (t.name === 'set') return `{${(v as unknown[]).map((x) => literal(t.args?.[0] ?? { name: 'text' }, x)).join(', ')}}`
  if (t.name === 'tuple') return `(${(v as unknown[]).map((x, i) => literal(t.args?.[i] ?? { name: 'text' }, x)).join(', ')})`
  if (t.name === 'map') {
    const [kt, vt] = t.args ?? [{ name: 'text' }, { name: 'text' }]
    return `{${(v as unknown[][]).map(([k, x]) => `${literal(kt, k)}: ${literal(vt, x)}`).join(', ')}}`
  }
  if (typeof v === 'string' && QUOTED.has(t.name)) return q(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * The text shown in a grid cell for a decoded value (SPEC §7.3). Top-level strings are shown bare,
 * collections and UDTs as CQL literals, blobs as a short hex preview with their length. Null is `null`.
 */
export function formatCell(t: TypeDesc, v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (t.name === 'blob') return blobText(v)
  if (t.name === 'list' || t.name === 'set' || t.name === 'map' || t.name === 'tuple' || t.name === 'vector' || t.udt) return literal(t, v)
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

/** The ISO time embedded in a version-1 UUID, or undefined for anything else. */
export function timeuuidTime(id: string): string | undefined {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-1([0-9a-f]{3})-/i.exec(id)
  if (!m) return undefined
  const ticks = (BigInt(`0x${m[3]}`) << 48n) | (BigInt(`0x${m[2]}`) << 32n) | BigInt(`0x${m[1]}`)
  const ms = Number(ticks / 10000n) - 12219292800000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
