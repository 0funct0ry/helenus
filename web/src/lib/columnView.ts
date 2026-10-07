import { typeFamily, unfreeze } from './typeFamily'

/** Pure helpers behind the grid's column actions (SPEC §9.5.2): client-side sort, local filters and the view-to-source row map. */

export type SortDir = 'asc' | 'desc'
export interface Sort {
  column: string
  dir: SortDir
}

export type FilterOp =
  | 'contains' | 'ncontains' | 'eq' | 'neq' | 'starts' | 'ends'
  | 'lt' | 'le' | 'gt' | 'ge' | 'between'
  | 'before' | 'after'
  | 'true' | 'false'
  | 'null' | 'notnull'

export interface Filter {
  op: FilterOp
  value?: string
  value2?: string
  matchCase?: boolean
}

/** Everything the grid remembers per results tab about its columns. */
export interface ColumnView {
  /** Selected column names, in selection order. */
  selected: string[]
  /** Column last clicked, the anchor of a Shift+click range. */
  anchor: string | null
  sort: Sort | null
  filters: Record<string, Filter>
  hidden: string[]
  /** Statement or table the view belongs to: a different one resets everything, hidden columns included. */
  viewKey?: string
  /** Identity of the loaded page: a new page or a re-run resets selection, sort and filters. */
  resetKey?: unknown
}

export const emptyColumnView: ColumnView = { selected: [], anchor: null, sort: null, filters: {}, hidden: [] }

const baseType = (type: string) => unfreeze(type).toLowerCase()

/** False for collections, maps, tuples, UDTs, vectors and duration. */
export function sortable(type: string): boolean {
  const f = typeFamily(type)
  if (f === 'coll' || f === 'udt' || f === 'vec') return false
  return baseType(type) !== 'duration'
}

export const SORT_REASON = 'This type can’t be sorted'

const isNull = (v: unknown) => v === null || v === undefined

// ---------- exact decimals ----------

interface Dec {
  n: bigint
  scale: number // value = n / 10^scale
}

const DEC = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i

/** Parses an integer, decimal or exponent number exactly; null when it is not one. */
export function parseDecimal(s: string): Dec | null {
  const t = s.trim()
  const m = DEC.exec(t)
  if (!m || (m[2] === '' && m[3] === '')) return null
  const n = BigInt(`${m[2]}${m[3]}` || '0') * (m[1] === '-' ? -1n : 1n)
  return { n, scale: m[3].length - (m[4] ? Number(m[4]) : 0) }
}

function cmpDec(a: Dec, b: Dec): number {
  const s = Math.max(a.scale, b.scale, 0)
  const x = a.n * 10n ** BigInt(s - a.scale)
  const y = b.n * 10n ** BigInt(s - b.scale)
  return x < y ? -1 : x > y ? 1 : 0
}

const isFloatType = (type: string) => ['float', 'double'].includes(baseType(type))

/** A number cell as a float (NaN stays NaN); non-numeric text is NaN too. */
function toFloat(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (/^nan$/i.test(s)) return NaN
  if (/^[+-]?inf(inity)?$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity
  return s === '' ? NaN : Number(s)
}

// ---------- comparators ----------

/** Compares two code points' order, not UTF-16 units. */
function cmpCodePoints(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!
    const y = b.codePointAt(j)!
    if (x !== y) return x < y ? -1 : 1
    i += x > 0xffff ? 2 : 1
    j += y > 0xffff ? 2 : 1
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0
}

function inetBytes(s: string): number[] | null {
  const t = s.trim()
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t)
  if (v4) return v4.slice(1).map(Number)
  if (!t.includes(':')) return null
  const [head, tail = ''] = t.split('::')
  const h = head ? head.split(':') : []
  const tl = t.includes('::') && tail ? tail.split(':') : []
  const fill = t.includes('::') ? 8 - h.length - tl.length : 0
  const groups = [...h, ...Array<string>(Math.max(0, fill)).fill('0'), ...tl]
  const out: number[] = []
  for (const g of groups) {
    const w = parseInt(g || '0', 16)
    out.push((w >> 8) & 255, w & 255)
  }
  return out
}

function cmpBytes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length - b.length < 0 ? -1 : a.length > b.length ? 1 : 0
}

/** Time embedded in a version-1 UUID as 100ns ticks, or null. */
function uuidTicks(id: string): bigint | null {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-1([0-9a-f]{3})-/i.exec(id)
  if (!m) return null
  return (BigInt(`0x${m[3]}`) << 48n) | (BigInt(`0x${m[2]}`) << 32n) | BigInt(`0x${m[1]}`)
}

function normTime(s: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s.trim())
  if (!m) return s
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}.${(m[4] ?? '').padEnd(9, '0')}`
}

function toMillis(s: string): number {
  return Date.parse(s)
}

const blobText = (v: unknown) => (typeof v === 'object' && v !== null && 'preview' in v ? String((v as { preview: string }).preview) : String(v)).toLowerCase()

/**
 * Orders two non-null wire values of `type`. NaN floats sort after every number. Callers place NULLs
 * themselves; types that cannot be sorted compare equal.
 */
export function compareValues(type: string, a: unknown, b: unknown): number {
  const t = baseType(type)
  switch (typeFamily(type)) {
    case 'num':
    case 'counter': {
      if (isFloatType(type)) {
        const x = toFloat(a)
        const y = toFloat(b)
        const nx = Number.isNaN(x)
        const ny = Number.isNaN(y)
        if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1
        return x < y ? -1 : x > y ? 1 : 0
      }
      const x = parseDecimal(String(a))
      const y = parseDecimal(String(b))
      if (!x || !y) return x ? -1 : y ? 1 : 0
      return cmpDec(x, y)
    }
    case 'bool': {
      const x = String(a) === 'true'
      const y = String(b) === 'true'
      return x === y ? 0 : x ? 1 : -1
    }
    case 'time': {
      if (t === 'time') return cmpCodePoints(normTime(String(a)), normTime(String(b)))
      const x = toMillis(String(a))
      const y = toMillis(String(b))
      if (Number.isNaN(x) || Number.isNaN(y)) return cmpCodePoints(String(a), String(b))
      return x < y ? -1 : x > y ? 1 : 0
    }
    case 'uuid': {
      const sa = String(a).toLowerCase()
      const sb = String(b).toLowerCase()
      if (t === 'timeuuid') {
        const x = uuidTicks(sa)
        const y = uuidTicks(sb)
        if (x !== null && y !== null && x !== y) return x < y ? -1 : 1
      }
      return cmpCodePoints(sa.replace(/-/g, ''), sb.replace(/-/g, ''))
    }
    case 'blob':
      return cmpCodePoints(blobText(a), blobText(b))
    case 'text': {
      if (t === 'inet') {
        const x = inetBytes(String(a))
        const y = inetBytes(String(b))
        if (x && y) return x.length !== y.length ? x.length - y.length : cmpBytes(x, y)
      }
      return cmpCodePoints(String(a), String(b))
    }
    default:
      return 0
  }
}

// ---------- filters ----------

interface OpDef {
  op: FilterOp
  label: string
  /** Number of value inputs: 0, 1 or 2. */
  inputs: 0 | 1 | 2
}

const NULL_OPS: OpDef[] = [
  { op: 'null', label: 'is null', inputs: 0 },
  { op: 'notnull', label: 'is not null', inputs: 0 },
]

/** Operators offered for a column of `type`, in menu order. */
export function filterOps(type: string): OpDef[] {
  const f = typeFamily(type)
  const t = baseType(type)
  if (f === 'num' || f === 'counter') {
    return [
      { op: 'eq', label: '=', inputs: 1 }, { op: 'neq', label: '≠', inputs: 1 }, { op: 'lt', label: '<', inputs: 1 }, { op: 'le', label: '≤', inputs: 1 },
      { op: 'gt', label: '>', inputs: 1 }, { op: 'ge', label: '≥', inputs: 1 }, { op: 'between', label: 'between', inputs: 2 }, ...NULL_OPS,
    ]
  }
  if (f === 'time' && t !== 'duration') {
    return [{ op: 'before', label: 'before', inputs: 1 }, { op: 'after', label: 'after', inputs: 1 }, { op: 'between', label: 'between', inputs: 2 }, ...NULL_OPS]
  }
  if (f === 'bool') return [{ op: 'true', label: 'is true', inputs: 0 }, { op: 'false', label: 'is false', inputs: 0 }, ...NULL_OPS]
  if (f === 'text' || f === 'uuid') {
    return [
      { op: 'contains', label: 'contains', inputs: 1 }, { op: 'ncontains', label: 'does not contain', inputs: 1 }, { op: 'eq', label: 'equals', inputs: 1 },
      { op: 'neq', label: 'does not equal', inputs: 1 }, { op: 'starts', label: 'starts with', inputs: 1 }, { op: 'ends', label: 'ends with', inputs: 1 }, ...NULL_OPS,
    ]
  }
  return [{ op: 'contains', label: 'contains', inputs: 1 }, ...NULL_OPS]
}

/** Whether the "Match case" checkbox applies to this column's operators. */
export function hasMatchCase(type: string): boolean {
  const f = typeFamily(type)
  return f === 'text' || f === 'uuid'
}

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i
const TIME_OF_DAY = /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/

function validInput(type: string, s: string | undefined): boolean {
  if (s === undefined || s.trim() === '') return false
  const f = typeFamily(type)
  if (f === 'num' || f === 'counter') return parseDecimal(s) !== null
  if (f === 'time') return baseType(type) === 'time' ? TIME_OF_DAY.test(s.trim()) : ISO.test(s.trim()) && !Number.isNaN(Date.parse(s.trim()))
  return true
}

/** An inline error message for an unusable filter, or null when it can be applied. */
export function validateFilter(type: string, f: Filter): string | null {
  const def = filterOps(type).find((o) => o.op === f.op)
  if (!def) return 'Choose an operator'
  const f1 = typeFamily(type)
  const kind = f1 === 'num' || f1 === 'counter' ? 'a number' : baseType(type) === 'time' ? 'a time like 10:30:00' : 'an ISO 8601 date or date-time'
  if (def.inputs >= 1 && !validInput(type, f.value)) return f.value?.trim() ? `Enter ${kind}` : 'Enter a value'
  if (def.inputs === 2 && !validInput(type, f.value2)) return f.value2?.trim() ? `Enter ${kind}` : 'Enter a second value'
  return null
}

/** Short text for the header chip's tooltip, e.g. `> 100` or `between 1 and 5`. */
export function describeFilter(type: string, f: Filter): string {
  const label = filterOps(type).find((o) => o.op === f.op)?.label ?? f.op
  const def = filterOps(type).find((o) => o.op === f.op)
  if (!def || def.inputs === 0) return label
  if (def.inputs === 2) return `${label} ${f.value} and ${f.value2}`
  return `${label} ${f.value}`
}

function cmpToInput(type: string, cell: unknown, input: string): number | null {
  const f = typeFamily(type)
  if (f === 'num' || f === 'counter') {
    if (isFloatType(type)) {
      const x = toFloat(cell)
      const y = Number(input)
      return Number.isNaN(x) || !Number.isFinite(x) ? null : x < y ? -1 : x > y ? 1 : 0
    }
    const x = parseDecimal(String(cell))
    const y = parseDecimal(input)
    return x && y ? cmpDec(x, y) : null
  }
  if (baseType(type) === 'time') return cmpCodePoints(normTime(String(cell)), normTime(input))
  const x = Date.parse(String(cell))
  const y = Date.parse(input.trim())
  if (Number.isNaN(x) || Number.isNaN(y)) return null
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Whether a cell passes `f`. `wire` is the decoded value and `display` its grid text; text operators use
 * the display text. NULL cells match only "is null".
 */
export function matchesFilter(type: string, f: Filter, wire: unknown, display: string | null): boolean {
  const nul = isNull(wire) || display === null
  if (f.op === 'null') return nul
  if (f.op === 'notnull') return !nul
  if (nul) return false
  const fam = typeFamily(type)
  if (f.op === 'true' || f.op === 'false') return String(wire) === f.op
  if (fam === 'num' || fam === 'counter' || fam === 'time') {
    const c = cmpToInput(type, wire, f.value ?? '')
    if (c === null) return false
    switch (f.op) {
      case 'eq': return c === 0
      case 'neq': return c !== 0
      case 'lt': case 'before': return c < 0
      case 'le': return c <= 0
      case 'gt': case 'after': return c > 0
      case 'ge': return c >= 0
      case 'between': {
        const hi = cmpToInput(type, wire, f.value2 ?? '')
        const lo = c
        return hi !== null && lo >= 0 && hi <= 0
      }
      default: return false
    }
  }
  const norm = (s: string) => (f.matchCase ? s : s.toLowerCase())
  const cell = norm(display)
  const want = norm(f.value ?? '')
  switch (f.op) {
    case 'contains': return cell.includes(want)
    case 'ncontains': return !cell.includes(want)
    case 'eq': return cell === want
    case 'neq': return cell !== want
    case 'starts': return cell.startsWith(want)
    case 'ends': return cell.endsWith(want)
    default: return false
  }
}

// ---------- the view map ----------

export interface ViewInput {
  count: number
  /** Pending inserts: kept visible and pinned at their position. */
  pinned: (source: number) => boolean
  typeOf: (column: string) => string | undefined
  wire: (source: number, column: string) => unknown
  display: (source: number, column: string) => string | null
  sort: Sort | null
  filters: Record<string, Filter>
}

/**
 * The displayed rows as source indexes: filtered, then stably sorted (NULL always last), with pending
 * inserts pinned at their original position. Display position is for rendering only.
 */
export function buildViewMap(v: ViewInput): number[] {
  const filtered = Object.entries(v.filters)
  let idx: number[] = []
  const pinned: number[] = []
  for (let i = 0; i < v.count; i++) {
    if (v.pinned(i)) {
      pinned.push(i)
      continue
    }
    const ok = filtered.every(([col, f]) => {
      const t = v.typeOf(col)
      return t === undefined || matchesFilter(t, f, v.wire(i, col), v.display(i, col))
    })
    if (ok) idx.push(i)
  }
  const type = v.sort ? v.typeOf(v.sort.column) : undefined
  if (v.sort && type !== undefined) {
    const { column, dir } = v.sort
    const sign = dir === 'asc' ? 1 : -1
    const keyed = idx.map((i, pos) => ({ i, pos, w: v.wire(i, column) }))
    keyed.sort((a, b) => {
      const an = isNull(a.w)
      const bn = isNull(b.w)
      if (an || bn) return an === bn ? a.pos - b.pos : an ? 1 : -1
      const c = compareValues(type, a.w, b.w)
      if (c !== 0 && isFloatType(type) && (Number.isNaN(toFloat(a.w)) || Number.isNaN(toFloat(b.w)))) return c // NaN stays after numbers either way
      return c !== 0 ? c * sign : a.pos - b.pos
    })
    idx = keyed.map((k) => k.i)
  }
  for (const p of pinned) idx.splice(Math.min(p, idx.length), 0, p)
  return idx
}

/** Range of column names between two columns, inclusive, in current order. */
export function columnRange(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return [b]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}
