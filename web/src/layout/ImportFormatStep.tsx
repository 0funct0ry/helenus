import { Select } from '../ui/Select'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Toggle } from '../ui/Toggle'
import { Field } from '../ui/Field'
import { DELIMITERS } from '../lib/importModel'
import type { ImportFormat, ImportFormatKind } from '../api/types'

export interface ImportFormatStepProps {
  format: ImportFormat
  /** Source column names, or empty while the plan loads. */
  columns: string[]
  /** The first 20 records as text. */
  preview: string[][]
  onChange: (format: ImportFormat) => void
}

/**
 * Step 2 of the import wizard: the detected format, delimiter and header setting, all editable, with a raw preview of
 * the first 20 records. CSV-only controls are hidden for JSON and NDJSON.
 */
export function ImportFormatStep({ format, columns, preview, onChange }: ImportFormatStepProps) {
  const csv = format.format === 'csv'
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl<ImportFormatKind>
          label="Format"
          value={format.format}
          options={[
            { value: 'csv', label: 'CSV / TSV' },
            { value: 'json', label: 'JSON array' },
            { value: 'ndjson', label: 'NDJSON' },
          ]}
          onChange={(f) => onChange({ ...format, format: f, delimiter: f === 'csv' ? format.delimiter || ',' : '', quote: f === 'csv' ? '"' : '' })}
        />
        {csv && (
          <>
            <Select aboveDialog label="Delimiter" value={format.delimiter} options={DELIMITERS} onChange={(delimiter) => onChange({ ...format, delimiter })} />
            <Toggle checked={format.header} onChange={(header) => onChange({ ...format, header })}>
              First row is a header
            </Toggle>
            <Field label="NULL text" value={format.null_string} className="!mb-0 w-32" onChange={(e) => onChange({ ...format, null_string: e.target.value })} />
          </>
        )}
      </div>
      <div className="max-h-72 overflow-auto rounded border border-line2">
        <table aria-label="Raw preview" className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="sticky top-0 border-b border-line2 bg-panel px-2 py-1 text-left font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i}>
                {columns.map((c, k) => (
                  <td key={c} className="max-w-[240px] truncate border-b border-line2 px-2 py-0.5">
                    {row[k] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {preview.length === 0 && <p className="m-2 text-muted">No records could be read with these settings.</p>}
      </div>
    </div>
  )
}
