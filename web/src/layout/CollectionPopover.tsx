import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { TypeDesc } from '../api/types'
import { Popover } from '../ui/Popover'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TypeBadge } from '../ui/TypeBadge'
import { ValueEditor } from './ValueEditor'
import { InputValidity } from '../lib/inputValidity'
import { typeToCql } from '../lib/cellFormat'
import { canonical, getAt, newValue, setAt, typeAt } from '../lib/valueModel'
import type { Crumb, UdtFields } from '../lib/valueModel'

export interface CollectionPopoverProps {
  open: boolean
  onClose: () => void
  /** The cell (or button) the popover hangs from. */
  anchorRef: RefObject<HTMLElement | null>
  /** Column name shown in the header. */
  name: string
  type: TypeDesc
  /** The value the cell holds now; null when unset. */
  original: unknown
  /** An already staged edit to start from instead of `original`. */
  draft?: unknown
  udtFields?: UdtFields
  /** Called with the whole edited value when Stage change is pressed. The caller works out the changes. */
  onStage: (draft: unknown) => void
  /** Label of the confirming button. */
  stageLabel?: string
  /** Stack above a modal dialog, for popovers opened from the insert dialog. */
  aboveDialog?: boolean
}

/**
 * Popover editor for a collection, UDT, tuple or vector cell (SPEC §9.10). One popover holds the whole
 * edit: collections that contain other collections or UDTs drill down inside it, with a breadcrumb to go
 * back up, rather than opening nested popovers. Inputs validate against their element types, and Stage
 * change stays disabled while any input is invalid or nothing differs from the starting value.
 */
export function CollectionPopover({ open, onClose, anchorRef, name, type, original, draft, udtFields, onStage, stageLabel = 'Stage change', aboveDialog }: CollectionPopoverProps) {
  const start = draft ?? original ?? newValue(type, udtFields)
  const [root, setRoot] = useState<unknown>(start)
  const [path, setPath] = useState<Crumb[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setRoot(draft ?? original ?? newValue(type, udtFields))
    setPath([])
    setErrors({})
    // Reset only when the popover opens; edits in progress must not be overwritten by re-renders.
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

  const steps = path.flatMap((c) => c.steps)
  const here = typeAt(type, path, udtFields)
  const firstError = Object.values(errors)[0]
  const unchanged = canonical(root) === canonical(start)

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} aria-label={`Edit ${name}`} aboveDialog={aboveDialog} className="w-[420px]">
      <div className="flex items-center gap-2 border-b border-line2 py-[9px] pl-3 pr-2.5">
        <b className="font-mono font-semibold">{name}</b>
        <TypeBadge type={typeToCql(type)} />
        <div className="flex-1" />
        <IconButton label="Close" icon={<X size={14} />} onClick={onClose} />
      </div>
      {path.length > 0 && (
        <nav aria-label="Nested value" className="flex flex-wrap items-center gap-0.5 border-b border-line2 px-2.5 py-1 text-xs">
          <button type="button" className="rounded px-1 text-accent hover:bg-hover" onClick={() => setPath([])}>
            {name}
          </button>
          {path.map((c, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight size={11} className="text-muted" />
              {i === path.length - 1 ? (
                <span aria-current="location" className="px-1 font-mono">{c.label}</span>
              ) : (
                <button type="button" className="rounded px-1 font-mono text-accent hover:bg-hover" onClick={() => setPath(path.slice(0, i + 1))}>
                  {c.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}
      <InputValidity.Provider value={report}>
        <ValueEditor
          key={steps.join('/')}
          type={here}
          value={getAt(root, steps)}
          onChange={(v) => setRoot((r: unknown) => setAt(r, steps, v))}
          onDrill={(c) => setPath((p) => [...p, c])}
          udtFields={udtFields}
        />
      </InputValidity.Provider>
      {firstError && (
        <p role="alert" className="m-0 border-t border-line2 px-3 py-1.5 text-[11.5px] text-danger">
          {firstError}
        </p>
      )}
      <div className="flex items-center gap-1.5 border-t border-line2 px-2.5 py-2">
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!!firstError || unchanged}
          title={firstError ?? (unchanged ? 'Nothing has changed' : undefined)}
          onClick={() => {
            onStage(root)
            onClose()
          }}
        >
          {stageLabel}
        </Button>
      </div>
    </Popover>
  )
}
