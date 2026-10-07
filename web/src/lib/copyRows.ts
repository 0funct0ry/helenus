import { formatRows } from '../api/rows'
import { describeError } from '../api/client'
import type { RowFormat, RowsFormatRequest } from '../api/types'
import { useToasts } from '../store/toast'

/** Menu order and labels of the Copy As formats. */
export const ROW_FORMATS: { format: RowFormat; label: string }[] = [
  { format: 'json', label: 'JSON' },
  { format: 'csv', label: 'CSV' },
  { format: 'tsv', label: 'TSV' },
  { format: 'xml', label: 'XML' },
  { format: 'yaml', label: 'YAML' },
  { format: 'markdown', label: 'Markdown' },
  { format: 'html', label: 'HTML' },
  { format: 'sql_inserts', label: 'SQL Inserts' },
  { format: 'sql_updates', label: 'SQL Updates' },
  { format: 'where', label: 'Where Clause' },
]

/**
 * Format rows on the server and copy the text to the clipboard, then toast "Copied 3 rows as CSV".
 * On any failure an error toast is shown and the clipboard is left untouched. Resolves to true when copied.
 */
export async function copyRowsAs(profile: string, req: RowsFormatRequest): Promise<boolean> {
  const push = useToasts.getState().push
  const label = ROW_FORMATS.find((f) => f.format === req.format)?.label ?? req.format
  try {
    const text = await formatRows(profile, req)
    if (!navigator.clipboard) throw new Error('The clipboard is not available in this browser context')
    await navigator.clipboard.writeText(text)
    push(`Copied ${req.rows.length} ${req.rows.length === 1 ? 'row' : 'rows'} as ${label}`)
    return true
  } catch (e) {
    push(`Copy failed: ${describeError(e)}`)
    return false
  }
}

/** What the Copy As availability rules need to know about the result. */
export interface RowSource {
  keyspace: string
  table: string
  counter?: boolean
  /** Every primary key column of the table is in the result. */
  keysComplete: boolean
}

/**
 * Why a Copy As format is unavailable, or null. Only the three SQL formats can be (SPEC §9.5.1): they
 * need a single source table; Updates and Where also need every key column in the result; Updates also
 * needs a non-counter table with at least one non-key column.
 */
export function formatDisabledReason(format: RowFormat, source: RowSource | null, columns: { kind?: string }[]): string | null {
  if (format !== 'sql_inserts' && format !== 'sql_updates' && format !== 'where') return null
  if (!source) return 'Needs a result from a single table. Open the table’s Data view.'
  if (format === 'sql_inserts') return null
  if (!source.keysComplete) return 'The result is missing a primary key column.'
  if (format === 'where') return null
  if (source.counter) return 'Counter tables are updated with increments, not assignments.'
  if (!columns.some((c) => c.kind !== 'partition' && c.kind !== 'clustering')) return 'The result has no non-key columns.'
  return null
}
