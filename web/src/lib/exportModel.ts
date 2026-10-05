import type { ExportFormat, ExportOptions, ExportPreset } from '../api/types'

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'csv', label: 'CSV', ext: 'csv' },
  { value: 'json', label: 'JSON', ext: 'json' },
  { value: 'ndjson', label: 'NDJSON', ext: 'ndjson' },
  { value: 'xml', label: 'XML', ext: 'xml' },
  { value: 'excel', label: 'Excel', ext: 'xlsx' },
  { value: 'cql', label: 'CQL', ext: 'cql' },
]

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { header: true, delimiter: ',', quote: '"', null_string: '', datetime_format: '' }

export function extensionOf(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.value === format)?.ext ?? format
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `<name>-<yyyyMMdd-HHmm>.<ext>` in local time; `name` falls back to "query". */
export function defaultExportFilename(name: string, format: ExportFormat, now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${name || 'query'}-${stamp}.${extensionOf(format)}`
}

/** Which options a format uses, so the dialog shows only those. */
export function optionsFor(format: ExportFormat): (keyof ExportOptions)[] {
  switch (format) {
    case 'csv':
      return ['header', 'delimiter', 'quote', 'null_string', 'datetime_format']
    case 'excel':
      return ['header']
    default:
      return []
  }
}

/** Applying a preset to a table: the checked columns and the preset columns this table lacks. */
export function applyPreset(preset: ExportPreset, tableColumns: string[]): { format: ExportFormat; options: ExportOptions; selected: string[]; missing: string[] } {
  const have = new Set(tableColumns)
  const wanted = preset.columns ?? tableColumns
  return {
    format: preset.format,
    options: { ...DEFAULT_EXPORT_OPTIONS, ...preset.options },
    selected: tableColumns.filter((c) => wanted.includes(c)),
    missing: wanted.filter((c) => !have.has(c)),
  }
}

/** The preset body for the current dialog state; null columns when every column is checked. */
export function presetColumns(selected: string[], all: string[]): string[] | null {
  return selected.length === all.length ? null : selected
}
