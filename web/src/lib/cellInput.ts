import type { TypeDesc } from '../api/types'

/** The outcome of reading text typed into a cell: the value in the API's JSON encoding, or why not. */
export type Parsed = { ok: true; value: unknown } | { ok: false; error: string }

const INT_RANGE: Record<string, [bigint, bigint]> = {
  tinyint: [-128n, 127n],
  smallint: [-32768n, 32767n],
  int: [-2147483648n, 2147483647n],
  bigint: [-(2n ** 63n), 2n ** 63n - 1n],
}
const TEXT_TYPES = new Set(['text', 'varchar', 'ascii'])
const FLOAT_MAX = 3.4028234663852886e38
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const DURATION = /^-?(\d+(y|mo|w|d|h|m|s|ms|us|µs|ns))+$/

const fail = (error: string): Parsed => ({ ok: false, error })
const ok = (value: unknown): Parsed => ({ ok: true, value })

/** True for types the inline editor handles as one text value (everything except collections, tuples, vectors and UDTs). */
export function isScalar(t: TypeDesc): boolean {
  return !t.udt && !['list', 'set', 'map', 'tuple', 'vector'].includes(t.name)
}

/** True when an empty input is the empty string rather than null. */
export function isTextType(t: TypeDesc): boolean {
  return TEXT_TYPES.has(t.name)
}

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function isIPv6(s: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(s) || !s.includes(':')) return false
  const parts = s.split('::')
  if (parts.length > 2) return false
  const groups = (p: string) => (p === '' ? [] : p.split(':'))
  const all = parts.flatMap(groups)
  const last = all[all.length - 1]
  const v4 = last?.includes('.') ? 1 : 0
  if (v4 && !IPV4.test(last)) return false
  const count = all.length + v4
  const hexOk = all.slice(0, all.length - v4).every((g) => /^[0-9a-f]{1,4}$/i.test(g))
  return hexOk && (parts.length === 2 ? count < 8 : count === 8)
}

function parseTimestamp(text: string): Parsed {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(text)
  if (!m || !validDate(+m[1], +m[2], +m[3])) return fail('Enter an ISO-8601 timestamp, e.g. 2026-09-30T10:00:00Z')
  const [h, mi, s] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)]
  if (h > 23 || mi > 59 || s > 59) return fail('That time of day is not valid')
  const ms = Math.round(+`0.${m[7] ?? '0'}` * 1000)
  let offset = 0
  if (m[8] && m[8].toUpperCase() !== 'Z') {
    const o = /([+-])(\d{2}):?(\d{2})/.exec(m[8])!
    offset = (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +o[3])
  }
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], h, mi, s, ms) - offset * 60000
  return ok(new Date(t).toISOString())
}

/**
 * Read text typed into a cell as a value of `type`, validating it (UUID shape, numeric range, calendar
 * date, time of day, timestamp, inet, boolean, blob hex, duration). The result uses the API's JSON
 * encoding (SPEC §7.3): bigint, varint and decimal come back as strings.
 */
export function parseInput(type: TypeDesc, raw: string): Parsed {
  const text = raw.trim()
  const name = type.name
  if (TEXT_TYPES.has(name)) {
    if (name === 'ascii' && [...raw].some((ch) => ch.charCodeAt(0) > 127)) return fail('ascii accepts only ASCII characters')
    return ok(raw)
  }
  if (text === '') return fail('A value is required')
  if (name in INT_RANGE || name === 'counter') {
    if (!/^[+-]?\d+$/.test(text)) return fail('Enter a whole number')
    const [lo, hi] = INT_RANGE[name === 'counter' ? 'bigint' : name]
    const n = BigInt(text)
    if (n < lo || n > hi) return fail(`${name === 'counter' ? 'counter' : name} must be between ${lo} and ${hi}`)
    return ok(name === 'bigint' || name === 'counter' ? n.toString() : Number(n))
  }
  switch (name) {
    case 'varint':
      return /^[+-]?\d+$/.test(text) ? ok(BigInt(text).toString()) : fail('Enter a whole number')
    case 'decimal':
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? ok(text.replace(/^\+/, '')) : fail('Enter a decimal number, e.g. 12.50')
    case 'float':
    case 'double': {
      if (['NaN', 'Infinity', '-Infinity'].includes(text)) return ok(text)
      const n = Number(text)
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) || !Number.isFinite(n)) return fail('Enter a number')
      if (name === 'float' && Math.abs(n) > FLOAT_MAX) return fail('float is limited to about ±3.4e38')
      return ok(n)
    }
    case 'boolean':
      if (/^true$/i.test(text)) return ok(true)
      if (/^false$/i.test(text)) return ok(false)
      return fail('Enter true or false')
    case 'uuid':
      return UUID.test(text) ? ok(text.toLowerCase()) : fail('Enter a UUID like 7c9e6679-7425-40de-944b-e07fc1f90ae7')
    case 'timeuuid':
      if (!UUID.test(text)) return fail('Enter a UUID like 3f1a2b10-9d3c-11ef-8a6e-0242ac120002')
      return text[14] === '1' ? ok(text.toLowerCase()) : fail('A timeuuid must be a version 1 UUID')
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
      return m && validDate(+m[1], +m[2], +m[3]) ? ok(text) : fail('Enter a date as YYYY-MM-DD')
    }
    case 'time': {
      const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?$/.exec(text)
      return m && +m[1] < 24 && +m[2] < 60 && +m[3] < 60 ? ok(text) : fail('Enter a time as HH:MM:SS[.nnnnnnnnn]')
    }
    case 'timestamp':
      return parseTimestamp(text)
    case 'inet':
      return IPV4.test(text) || isIPv6(text) ? ok(text) : fail('Enter an IPv4 or IPv6 address')
    case 'blob':
      return /^0x([0-9a-f]{2})*$/i.test(text) ? ok(text.toLowerCase()) : fail('Enter bytes as hex starting with 0x, e.g. 0xcafe')
    case 'duration':
      return DURATION.test(text) ? ok(text) : fail('Enter a duration such as 1mo2d3h4m')
  }
  return fail(`${name} cannot be edited here`)
}

/** The text shown in an editor for an existing value (the inverse of parseInput). */
export function inputText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
