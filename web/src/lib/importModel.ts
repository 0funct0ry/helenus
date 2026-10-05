import type { ImportConfidence, ImportFormat, ImportOptions } from '../api/types'

export const defaultImportOptions: ImportOptions = {
  consistency: 'LOCAL_QUORUM',
  ttl: 0,
  if_not_exists: false,
  concurrency: 8,
  batch_size: 1,
  max_errors: 1000,
}

export const DELIMITERS = [
  { value: ',', label: 'Comma ( , )' },
  { value: ';', label: 'Semicolon ( ; )' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe ( | )' },
]

/** Format with the server's detected values and no NULL text. */
export function formatFromDetect(d: Omit<ImportFormat, 'null_string'>): ImportFormat {
  return { ...d, null_string: '' }
}

/** Field-level problems of the write options; the server enforces the same limits. */
export function validateImportOptions(o: ImportOptions): Partial<Record<keyof ImportOptions, string>> {
  const e: Partial<Record<keyof ImportOptions, string>> = {}
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > 64) e.concurrency = 'Use 1 to 64.'
  if (!Number.isInteger(o.batch_size) || o.batch_size < 1 || o.batch_size > 100) e.batch_size = 'Use 1 to 100.'
  if (!Number.isInteger(o.max_errors) || o.max_errors < 1) e.max_errors = 'Use at least 1.'
  if (!Number.isInteger(o.ttl) || o.ttl < 0) e.ttl = 'Use 0 or more seconds.'
  return e
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`
  return `${n} bytes`
}

export function formatEta(s: number): string {
  if (!s || !Number.isFinite(s)) return '–'
  return s < 60 ? `${Math.ceil(s)} s` : `${Math.floor(s / 60)} min ${Math.ceil(s % 60)} s`
}

export const confidenceLabel: Record<ImportConfidence, string> = {
  '': '',
  exact: 'exact',
  case: 'case',
  normalized: 'normalized',
  fuzzy: 'fuzzy',
  manual: 'manual',
}
