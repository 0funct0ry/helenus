import type { SeedConfig, SeedSpec, TypeDesc } from '../api/types'

/** Display names and one-line help for every generator the server knows. */
export const GENERATORS: Record<string, { label: string; help: string }> = {
  constant: { label: 'Constant', help: 'The same value in every row.' },
  null: { label: 'Null', help: 'Always null (not for key columns).' },
  sequence: { label: 'Sequence', help: 'start, start+step, … in row order.' },
  uuid: { label: 'UUID (v4)', help: 'A random version 4 UUID.' },
  timeuuid: { label: 'TimeUUID', help: 'A version 1 UUID at a random time in a range.' },
  int_range: { label: 'Integer range', help: 'A whole number between min and max.' },
  float_range: { label: 'Float range', help: 'A number between min and max, rounded to some decimals.' },
  decimal_range: { label: 'Decimal range', help: 'A decimal between min and max.' },
  boolean: { label: 'Boolean', help: 'true with the given probability.' },
  choice: { label: 'Choice', help: 'One of your values, optionally weighted.' },
  time_range: { label: 'Date/time range', help: 'A time between from and to (now-30d, 2024-01-31, …).' },
  duration_range: { label: 'Duration range', help: 'A duration between min and max seconds.' },
  inet: { label: 'IP address', help: 'A random IPv4 or IPv6 address.' },
  blob: { label: 'Random bytes', help: 'Random bytes of a length range.' },
  regex: { label: 'Regex', help: 'Text matching a regular expression.' },
  fake: { label: 'Fake data', help: 'Names, emails, cities and other realistic text.' },
  collection: { label: 'Collection', help: 'A list, set or map of generated elements.' },
  composite: { label: 'Tuple / UDT', help: 'One generator per field.' },
  vector: { label: 'Vector', help: 'Floats within a range, one per dimension.' },
}

export const FAKE_CATEGORIES = [
  'first_name', 'last_name', 'full_name', 'email', 'username', 'phone', 'company', 'job_title', 'street', 'city', 'state',
  'country', 'zip', 'url', 'ipv4', 'ipv6', 'word', 'sentence', 'paragraph', 'color', 'product', 'birthdate',
]

const INTS = ['tinyint', 'smallint', 'int', 'bigint', 'varint']
const TEXTS = ['text', 'ascii', 'varchar']

/** Mirrors the server's `seed.Compatible`, for nested elements whose type the server did not list. */
export function compatibleGenerators(t: TypeDesc): string[] {
  const n = t.name
  if (n === 'counter') return ['int_range']
  const base = ['constant', 'null']
  if (n === 'list' || n === 'set' || n === 'map') return [...base, 'collection']
  if (n === 'tuple' || t.udt) return [...base, 'composite']
  if (n === 'vector') return [...base, 'vector']
  const out: string[] = []
  if (INTS.includes(n) || TEXTS.includes(n)) out.push('sequence')
  if (INTS.includes(n)) out.push('int_range')
  else if (n === 'float' || n === 'double') out.push('float_range')
  else if (n === 'decimal') out.push('decimal_range')
  else if (n === 'boolean') out.push('boolean')
  else if (n === 'uuid') out.push('uuid')
  else if (n === 'timeuuid') out.push('timeuuid')
  else if (['timestamp', 'date', 'time'].includes(n)) out.push('time_range')
  else if (n === 'duration') out.push('duration_range')
  else if (n === 'inet') out.push('inet', 'fake')
  else if (n === 'blob') out.push('blob')
  else if (TEXTS.includes(n)) out.push('regex', 'fake')
  if (n === 'date') out.push('fake')
  return [...base, ...out, 'choice']
}

export const CONSISTENCIES = ['LOCAL_QUORUM', 'LOCAL_ONE', 'ONE', 'TWO', 'THREE', 'QUORUM', 'ALL', 'EACH_QUORUM']

/** A fresh configuration; the server fills in per-column defaults on the first preview. */
export function newSeedConfig(): SeedConfig {
  return {
    seed: randomSeed(),
    total_rows: 1000,
    rows_per_partition: 100,
    concurrency: 8,
    consistency: 'LOCAL_QUORUM',
    ttl: 0,
    if_not_exists: false,
    columns: {},
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000)
}

/** Field errors for one column (`columns.<name>…`), keyed by the part after the column name. */
export function errorsFor(errors: { field: string; message: string }[], prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of errors) {
    if (e.field === prefix) out[''] ??= e.message
    else if (e.field.startsWith(prefix + '.')) out[e.field.slice(prefix.length + 1)] ??= e.message
  }
  return out
}

/** Reads a numeric-or-text input back into a parameter: numbers when they parse, the raw text otherwise. */
export function paramValue(text: string): number | string {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) ? n : text
}

export function withParam(spec: SeedSpec, key: string, value: unknown): SeedSpec {
  const params = { ...spec.params }
  if (value === '' || value === undefined) delete params[key]
  else params[key] = value
  return { ...spec, params }
}

/** Parses the text typed for a constant according to the column type; falls back to the raw text. */
export function constantFromText(text: string, t: TypeDesc): unknown {
  if (INTS.includes(t.name) || ['float', 'double'].includes(t.name)) return paramValue(text)
  if (t.name === 'boolean') return text === 'true' ? true : text === 'false' ? false : text
  if (TEXTS.includes(t.name) || ['uuid', 'timeuuid', 'timestamp', 'date', 'time', 'inet', 'blob', 'duration', 'decimal'].includes(t.name)) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function constantToText(v: unknown): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Preview cells: scalars as they are, structures as compact JSON so the grid can show them. */
export function cellOf(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return JSON.stringify(v)
  return v as string | number | boolean
}
