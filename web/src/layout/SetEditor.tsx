import { useCallback, useContext, useEffect, useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { TypeDesc } from '../api/types'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'
import { ElementInput } from './ElementInput'
import { ScalarInput } from './ScalarInput'
import { InputValidity } from '../lib/inputValidity'
import { formatCell } from '../lib/cellFormat'
import { canonical, isComposite, newValue, sortSet } from '../lib/valueModel'
import type { Crumb, UdtFields } from '../lib/valueModel'

export interface SetEditorProps {
  type: TypeDesc
  value: unknown[]
  onChange: (value: unknown[]) => void
  onDrill: (crumb: Crumb) => void
  udtFields?: UdtFields
}

/**
 * Editor for a set: the members sorted and unique, with a remove button on each and a typed input to add
 * one. Adding a value that is already a member is blocked with an inline message. Sets of collections or
 * UDTs add an empty member that opens a nested editor, and flag duplicates instead of blocking them.
 */
export function SetEditor({ type, value, onChange, onDrill, udtFields }: SetEditorProps) {
  const el = type.args?.[0] ?? { name: 'text' }
  const composite = isComposite(el)
  const [pending, setPending] = useState<unknown>(null)
  const [typed, setTyped] = useState(0)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const id = useId()
  const report = useContext(InputValidity)

  const reportNew = useCallback((_: string, e: string | null) => setPendingError(e), [])
  const seen = value.map(canonical)
  const dupes = composite ? new Set(seen.filter((c, i) => seen.indexOf(c) !== i)) : new Set<string>()
  const addError = pendingError ?? (pending !== null && seen.includes(canonical(pending)) ? 'That value is already in the set.' : null)
  const dupMessage = dupes.size ? 'This set has a duplicate member.' : null

  useEffect(() => {
    report(id, dupMessage)
    return () => report(id, null)
  }, [id, dupMessage, report])

  const add = () => {
    if (pending === null || addError) return
    onChange(sortSet(type, [...value, pending]))
    setPending(null)
    setTyped((n) => n + 1)
  }

  return (
    <div>
      <ul className="m-0 max-h-[220px] list-none overflow-auto p-0 px-2.5 py-2">
        {value.length === 0 && <li className="py-2 text-center text-xs text-muted">The set is empty.</li>}
        {value.map((v, i) => (
          <li key={i} className="mb-1.5 grid items-center gap-1.5" style={{ gridTemplateColumns: '1fr 22px' }}>
            {composite ? (
              <ElementInput
                type={el}
                value={v}
                label={`Member ${i}`}
                flagged={dupes.has(canonical(v))}
                onChange={(x) => onChange(value.map((o, n) => (n === i ? x : o)))}
                onDrill={() => onDrill({ steps: [i], label: `{${i}}` })}
              />
            ) : (
              <span className="flex h-7 items-center truncate rounded border border-line2 bg-surface px-2 font-mono text-[12.5px]" title={formatCell(el, v) ?? ''}>
                {formatCell(el, v)}
              </span>
            )}
            <IconButton label={`Remove ${formatCell(el, v) ?? 'member'}`} icon={<X size={12} />} onClick={() => onChange(value.filter((_, n) => n !== i))} />
          </li>
        ))}
      </ul>
      {composite ? (
        <div className="px-2.5 pb-2">
          <Button variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...value, newValue(el, udtFields)])}>
            Add member
          </Button>
        </div>
      ) : (
        <div className="px-2.5 pb-2">
          <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: '1fr auto' }}>
            <InputValidity.Provider value={reportNew}>
              <ScalarInput key={typed} type={el} value={pending} optional onChange={setPending} aria-label="New member" flagged={!!addError} />
            </InputValidity.Provider>
            <Button disabled={pending === null || !!addError} onClick={add}>
              Add
            </Button>
          </div>
          {addError && <p className="m-0 mt-1 text-[11.5px] text-danger">{addError}</p>}
        </div>
      )}
    </div>
  )
}
