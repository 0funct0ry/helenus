import { useEffect, useId, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '../ui/Button'
import { Popover } from '../ui/Popover'
import { filterOps, hasMatchCase, validateFilter } from '../lib/columnView'
import type { Filter, FilterOp } from '../lib/columnView'
import { cn } from '../lib/cn'

export interface ColumnFilterPopoverProps {
  open: boolean
  /** The header cell the popover hangs under. */
  anchorRef: RefObject<HTMLElement | null>
  /** Column the filter belongs to; its type decides the operators and input validation. */
  column: { name: string; type: string }
  /** The column's current filter, if any, used to prefill the form. */
  filter?: Filter
  onApply: (f: Filter) => void
  /** Removes this column's filter. */
  onClear: () => void
  onClose: () => void
}

/**
 * Popover for a column's local filter: an operator dropdown (a Tailwind list, not a native select), one or
 * two value inputs, a Match case checkbox for text types, and Apply / Clear. Enter applies, Escape cancels.
 * Invalid input shows an inline error and keeps Apply disabled.
 */
export function ColumnFilterPopover({ open, anchorRef, column, filter, onApply, onClear, onClose }: ColumnFilterPopoverProps) {
  const ops = filterOps(column.type)
  const [op, setOp] = useState<FilterOp>(filter?.op ?? ops[0].op)
  const [value, setValue] = useState(filter?.value ?? '')
  const [value2, setValue2] = useState(filter?.value2 ?? '')
  const [matchCase, setMatchCase] = useState(filter?.matchCase ?? false)
  const [listOpen, setListOpen] = useState(false)
  const listId = useId()
  useEffect(() => {
    if (!open) return
    setOp(filter?.op ?? ops[0].op)
    setValue(filter?.value ?? '')
    setValue2(filter?.value2 ?? '')
    setMatchCase(filter?.matchCase ?? false)
    setListOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, column.name])
  const def = ops.find((o) => o.op === op) ?? ops[0]
  const candidate: Filter = { op, value: def.inputs >= 1 ? value : undefined, value2: def.inputs === 2 ? value2 : undefined, matchCase: hasMatchCase(column.type) ? matchCase : undefined }
  const touched = (def.inputs >= 1 && value !== '') || (def.inputs === 2 && value2 !== '')
  const error = validateFilter(column.type, candidate)
  const shownError = touched ? error : null
  const apply = () => {
    if (!error) onApply(candidate)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) {
      e.preventDefault()
      apply()
    }
  }
  const input = (v: string, set: (s: string) => void, label: string, autoFocus: boolean) => (
    <input
      aria-label={label}
      aria-invalid={shownError ? true : undefined}
      value={v}
      autoFocus={autoFocus}
      onChange={(e) => set(e.target.value)}
      className="h-6 w-full rounded border border-line bg-editor px-2 font-mono text-xs outline-none focus:border-accent"
    />
  )
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} role="dialog" aria-label={`Filter ${column.name}`} className="w-64 p-3 text-xs">
      <div onKeyDown={onKey} className="flex flex-col gap-2">
        <div className="font-mono font-medium">{column.name}</div>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-label={`Operator: ${def.label}`}
            onClick={() => setListOpen((o) => !o)}
            className="inline-flex h-6 w-full items-center justify-between rounded border border-line bg-editor pl-2 pr-1.5 hover:bg-hover"
          >
            {def.label}
            <ChevronDown size={12} />
          </button>
          {listOpen && (
            <ul id={listId} role="listbox" aria-label="Operator" className="absolute left-0 right-0 top-7 z-10 max-h-56 overflow-y-auto rounded-lg bg-elevated p-1 shadow-[var(--shadow)]">
              {ops.map((o) => (
                <li
                  key={o.op}
                  role="option"
                  aria-selected={o.op === op}
                  onClick={() => {
                    setOp(o.op)
                    setListOpen(false)
                  }}
                  className={cn('flex h-6 cursor-default items-center gap-2 whitespace-nowrap rounded px-2 hover:bg-selected')}
                >
                  <span className="w-3">{o.op === op && <Check size={12} />}</span>
                  {o.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        {def.inputs >= 1 && input(value, setValue, def.inputs === 2 ? 'From' : 'Value', true)}
        {def.inputs === 2 && input(value2, setValue2, 'To', false)}
        {hasMatchCase(column.type) && def.inputs >= 1 && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
            Match case
          </label>
        )}
        {shownError && (
          <p role="alert" className="m-0 text-danger">
            {shownError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
          <Button variant="primary" disabled={error !== null} onClick={apply}>
            Apply
          </Button>
        </div>
      </div>
    </Popover>
  )
}
