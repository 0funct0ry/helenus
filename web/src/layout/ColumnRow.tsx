import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { TypePicker } from './TypePicker'
import type { ColumnDraft } from '../lib/tableDraft'

export interface ColumnRowProps {
  column: ColumnDraft
  /** Position in the list (0-based) and list length; they disable the move buttons at the ends. */
  index: number
  count: number
  /** UDT names of the keyspace offered by the type picker. */
  udts: string[]
  /** Messages to show under the name and type, already filtered for visibility. */
  nameError?: string
  typeError?: string
  onChange: (column: ColumnDraft) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}

/**
 * One editable column of the New table wizard: name, type picker (with `counter`), a Static toggle and
 * move up/down/remove buttons. Accessible names include the row number so rows are distinguishable.
 */
export function ColumnRow({ column, index, count, udts, nameError, typeError, onChange, onRemove, onMove }: ColumnRowProps) {
  const n = index + 1
  return (
    <li className="flex flex-col gap-1 border-b border-line2 py-2">
      <div className="flex items-start gap-2">
        <div className="flex w-[200px] shrink-0 flex-col gap-1">
          <Input mono aria-label={`Column ${n} name`} aria-invalid={!!nameError} placeholder="column_name" value={column.name} onChange={(e) => onChange({ ...column, name: e.target.value })} />
        </div>
        <div className="min-w-0 flex-1">
          <TypePicker allowCounter value={column.type} onChange={(type) => onChange({ ...column, type })} udts={udts} label={`Column ${n} type`} />
        </div>
        <Toggle checked={column.static} onChange={(s) => onChange({ ...column, static: s })} aria-label={`Column ${n} static`}>
          static
        </Toggle>
        <IconButton label={`Move column ${n} up`} icon={<ArrowUp size={13} />} disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton label={`Move column ${n} down`} icon={<ArrowDown size={13} />} disabled={index === count - 1} onClick={() => onMove(1)} />
        <IconButton label={`Remove column ${n}`} icon={<X size={13} />} disabled={count === 1} onClick={onRemove} />
      </div>
      {nameError && <p className="m-0 text-xs text-danger">{nameError}</p>}
      {typeError && <p className="m-0 text-xs text-danger">{typeError}</p>}
    </li>
  )
}
