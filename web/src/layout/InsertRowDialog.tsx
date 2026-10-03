import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { QueryColumn } from '../api/types'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { ScalarInput } from './ScalarInput'
import { CollectionPopover } from './CollectionPopover'
import { InputValidity } from '../lib/inputValidity'
import { formatCell, typeToCql } from '../lib/cellFormat'
import { isComposite } from '../lib/valueModel'
import type { UdtFields } from '../lib/valueModel'

export interface InsertRowDialogProps {
  open: boolean
  onClose: () => void
  /** The table's columns with kinds and types (from a query result). */
  columns: QueryColumn[]
  /** Values to start from: the selected row when duplicating. Truncated blobs are dropped. */
  initial?: Record<string, unknown> | null
  /** `Duplicate row` changes the title and hint; the form is the same. */
  duplicate?: boolean
  udtFields?: UdtFields
  /** Called with the entered values (nulls omitted) and the IF NOT EXISTS choice. */
  onStage: (values: Record<string, unknown>, ifNotExists: boolean) => void
}

const isTruncated = (v: unknown) => typeof v === 'object' && v !== null && '$truncated' in v

/**
 * The form for adding a row: one typed input per column, with collection and UDT columns edited in the
 * collection popover. Every primary key column is required; the other columns may be left empty, which
 * omits them from the INSERT (SPEC §9.9). The IF NOT EXISTS switch makes the insert conditional. The row is
 * staged like any other edit and runs when the pending changes are applied.
 */
export function InsertRowDialog({ open, onClose, columns, initial, duplicate, udtFields, onStage }: InsertRowDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [ifNotExists, setIfNotExists] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [edit, setEdit] = useState<{ name: string; el: HTMLElement } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setValues(Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => !isTruncated(v))))
    setIfNotExists(false)
    setErrors({})
    setEdit(null)
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const report = useCallback((id: string, error: string | null) => {
    setErrors((prev) => {
      if (error === null) {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return prev[id] === error ? prev : { ...prev, [id]: error }
    })
  }, [])

  const filled = (v: unknown) => v !== null && v !== undefined && v !== ''
  const missing = columns.filter((c) => (c.kind === 'partition' || c.kind === 'clustering') && !filled(values[c.name]))
  const invalid = Object.keys(errors).length > 0
  const editing = edit ? columns.find((c) => c.name === edit.name) : undefined
  anchor.current = edit?.el ?? null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={duplicate ? 'Duplicate row' : 'Insert row'}
      subtitle={duplicate ? 'Change the key to create a new row' : 'The primary key is required'}
      width="min(620px, 94vw)"
      footer={
        <>
          <Toggle checked={ifNotExists} onChange={setIfNotExists}>
            IF NOT EXISTS
          </Toggle>
          {missing.length > 0 && <span className="text-xs text-muted">Fill in {missing.map((c) => c.name).join(', ')}</span>}
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={missing.length > 0 || invalid}
            onClick={() => {
              onStage(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined)), ifNotExists)
              onClose()
            }}
          >
            Stage insert
          </Button>
        </>
      }
    >
      <InputValidity.Provider value={report}>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {columns.map((c) => {
            const key = c.kind === 'partition' || c.kind === 'clustering'
            return (
              <div key={c.name} className="mb-2.5 grid items-center gap-3" style={{ gridTemplateColumns: '170px 1fr' }}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <KeyMarker kind={c.kind ?? 'regular'} position={c.position} order={c.order} />
                    <span className="truncate font-mono text-[12.5px]" title={c.name}>{c.name}</span>
                  </span>
                  <TypeBadge type={typeToCql(c.type)} />
                </span>
                {isComposite(c.type) ? (
                  <button
                    type="button"
                    aria-label={c.name}
                    onClick={(e) => setEdit({ name: c.name, el: e.currentTarget })}
                    className="flex h-7 w-full min-w-0 items-center gap-1 rounded border border-line bg-editor px-2 text-left font-mono text-[12.5px] hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-syn-const">{formatCell(c.type, values[c.name] ?? null) ?? <span className="italic text-dim">null</span>}</span>
                    <ChevronRight size={12} className="flex-none text-muted" />
                  </button>
                ) : (
                  <ScalarInput
                    aria-label={c.name}
                    type={c.type}
                    value={values[c.name] ?? null}
                    optional={!key}
                    onChange={(v) => setValues((cur) => ({ ...cur, [c.name]: v }))}
                  />
                )}
              </div>
            )
          })}
        </div>
      </InputValidity.Provider>
      {editing && (
        <CollectionPopover
          open
          aboveDialog
          onClose={() => setEdit(null)}
          anchorRef={anchor}
          name={editing.name}
          type={editing.type}
          original={null}
          draft={values[editing.name]}
          udtFields={udtFields}
          stageLabel="Set value"
          onStage={(v) => setValues((cur) => ({ ...cur, [editing.name]: v }))}
        />
      )}
    </Dialog>
  )
}
