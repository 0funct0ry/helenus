import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { optionsFor } from '../lib/exportModel'
import type { ExportFormat, ExportOptions } from '../api/types'

export interface ExportFormatOptionsProps {
  format: ExportFormat
  options: ExportOptions
  onChange: (options: ExportOptions) => void
}

const DELIMITERS = [
  { value: ',', label: 'Comma ,' },
  { value: ';', label: 'Semicolon ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe |' },
]

/**
 * The options that apply to the chosen export format: header row (CSV, Excel), and for CSV the delimiter, quote
 * character, NULL text and an optional timestamp pattern (strftime, e.g. %Y-%m-%d %H:%M:%S). Renders nothing for
 * formats without options.
 */
export function ExportFormatOptions({ format, options, onChange }: ExportFormatOptionsProps) {
  const used = optionsFor(format)
  if (used.length === 0) return <p className="m-0 text-xs text-muted">This format has no options.</p>
  const set = (patch: Partial<ExportOptions>) => onChange({ ...options, ...patch })
  return (
    <div className="flex flex-col gap-2">
      {used.includes('header') && (
        <Toggle checked={options.header} onChange={(header) => set({ header })}>
          Header row
        </Toggle>
      )}
      {used.includes('delimiter') && <Select aboveDialog label="Delimiter" value={options.delimiter} options={DELIMITERS} onChange={(delimiter) => set({ delimiter })} />}
      {used.includes('quote') && <Field label="Quote character" mono maxLength={1} value={options.quote} onChange={(e) => set({ quote: e.target.value })} />}
      {used.includes('null_string') && <Field label="NULL text" mono value={options.null_string} placeholder="(empty)" onChange={(e) => set({ null_string: e.target.value })} />}
      {used.includes('datetime_format') && (
        <Field label="Timestamp format" mono value={options.datetime_format} placeholder="default" onChange={(e) => set({ datetime_format: e.target.value })} />
      )}
    </div>
  )
}
