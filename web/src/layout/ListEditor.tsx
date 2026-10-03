import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react'
import type { TypeDesc } from '../api/types'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'
import { ElementInput } from './ElementInput'
import { newValue } from '../lib/valueModel'
import type { Crumb, UdtFields } from '../lib/valueModel'

export interface ListEditorProps {
  /** A list or vector type. */
  type: TypeDesc
  value: unknown[]
  onChange: (value: unknown[]) => void
  onDrill: (crumb: Crumb) => void
  udtFields?: UdtFields
}

/**
 * Editor for an ordered list (or a fixed-size vector): one row per element with a drag handle, move up
 * and down, and remove buttons, plus Add item. Vectors have a fixed length, so they cannot grow or
 * shrink. Elements that are themselves collections or UDTs open a nested editor.
 */
export function ListEditor({ type, value, onChange, onDrill, udtFields }: ListEditorProps) {
  const el = type.args?.[0] ?? { name: 'text' }
  const fixed = type.name === 'vector'
  const [dragging, setDragging] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return
    const next = [...value]
    next.splice(to, 0, next.splice(from, 1)[0])
    onChange(next)
  }
  return (
    <div>
      <ul className="m-0 max-h-[260px] list-none overflow-auto p-0 px-2.5 py-2">
        {value.length === 0 && <li className="py-2 text-center text-xs text-muted">{fixed ? 'This vector has no elements.' : 'The list is empty.'}</li>}
        {value.map((v, i) => (
          <li
            key={i}
            draggable={!fixed}
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => dragging !== null && e.preventDefault()}
            onDrop={() => {
              if (dragging !== null) move(dragging, i)
              setDragging(null)
            }}
            onDragEnd={() => setDragging(null)}
            className="mb-1.5 grid items-center gap-1.5"
            style={{ gridTemplateColumns: fixed ? '22px 1fr' : '16px 22px 1fr 22px 22px 22px' }}
          >
            {!fixed && <GripVertical size={14} className="cursor-grab text-muted" aria-hidden />}
            <span className="text-right font-mono text-[11px] text-faint">{i}</span>
            <ElementInput
              type={el}
              value={v}
              label={`Item ${i}`}
              onChange={(x) => onChange(value.map((o, n) => (n === i ? x : o)))}
              onDrill={() => onDrill({ steps: [i], label: `[${i}]` })}
            />
            {!fixed && (
              <>
                <IconButton label={`Move item ${i} up`} icon={<ArrowUp size={12} />} disabled={i === 0} onClick={() => move(i, i - 1)} />
                <IconButton label={`Move item ${i} down`} icon={<ArrowDown size={12} />} disabled={i === value.length - 1} onClick={() => move(i, i + 1)} />
                <IconButton label={`Remove item ${i}`} icon={<X size={12} />} onClick={() => onChange(value.filter((_, n) => n !== i))} />
              </>
            )}
          </li>
        ))}
      </ul>
      {!fixed && (
        <div className="px-2.5 pb-2">
          <Button variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...value, newValue(el, udtFields)])}>
            Add item
          </Button>
        </div>
      )}
    </div>
  )
}
