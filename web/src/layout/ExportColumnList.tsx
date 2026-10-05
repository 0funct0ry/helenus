import { KeyMarker } from '../ui/KeyMarker'
import type { Column } from '../lib/schemaModel'

export interface ExportColumnListProps {
  columns: Column[]
  selected: string[]
  onChange: (selected: string[]) => void
}

/** Checklist of a table's columns with key markers and a "Select all" box; unchecked columns are left out of the export. */
export function ExportColumnList({ columns, selected, onChange }: ExportColumnListProps) {
  const all = selected.length === columns.length
  const toggle = (name: string) => onChange(columns.map((c) => c.name).filter((n) => (n === name ? !selected.includes(n) : selected.includes(n))))
  return (
    <div className="rounded border border-line">
      <label className="flex items-center gap-2 border-b border-line px-2 py-1 text-xs text-muted">
        <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : columns.map((c) => c.name))} />
        Select all ({selected.length}/{columns.length})
      </label>
      <ul className="m-0 max-h-40 list-none overflow-auto p-0">
        {columns.map((c) => (
          <li key={c.name}>
            <label className="flex items-center gap-2 px-2 py-0.5 text-[12.5px]">
              <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggle(c.name)} />
              <span className="font-mono">{c.name}</span>
              <KeyMarker kind={c.kind} position={c.position} order={c.order} />
              <span className="ml-auto font-mono text-[11px] text-faint">{c.type}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
