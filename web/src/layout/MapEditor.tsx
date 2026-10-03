import { useContext, useEffect, useId } from 'react'
import { Plus, X } from 'lucide-react'
import type { TypeDesc } from '../api/types'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'
import { TypeBadge } from '../ui/TypeBadge'
import { ElementInput } from './ElementInput'
import { InputValidity } from '../lib/inputValidity'
import { typeToCql, formatCell } from '../lib/cellFormat'
import { canonical, newValue } from '../lib/valueModel'
import type { Crumb, UdtFields } from '../lib/valueModel'

export interface MapEditorProps {
  type: TypeDesc
  /** Entries as `[key, value]` pairs, the API's encoding of a map. */
  value: [unknown, unknown][]
  onChange: (value: [unknown, unknown][]) => void
  onDrill: (crumb: Crumb) => void
  udtFields?: UdtFields
}

/**
 * Editor for a map: one row per entry with a typed input for the key and for the value, and a remove
 * button. A key that appears twice is outlined and reported, which blocks staging. Keys or values that
 * are collections or UDTs open a nested editor.
 */
export function MapEditor({ type, value, onChange, onDrill, udtFields }: MapEditorProps) {
  const [kt, vt] = type.args ?? [{ name: 'text' }, { name: 'text' }]
  const id = useId()
  const report = useContext(InputValidity)
  const keys = value.map((p) => canonical(p[0]))
  const duplicated = value.filter((p, i) => keys.indexOf(canonical(p[0])) !== i)
  const message = duplicated.length ? `The key ${formatCell(kt, duplicated[0][0]) ?? 'null'} already exists in this map.` : null

  useEffect(() => {
    report(id, message)
    return () => report(id, null)
  }, [id, message, report])

  return (
    <div>
      <div className="grid gap-1.5 px-2.5 pt-2 text-[11.5px] text-muted" style={{ gridTemplateColumns: '1fr 1fr 22px' }}>
        <span className="flex items-center gap-1.5">
          Key <TypeBadge type={typeToCql(kt)} />
        </span>
        <span className="flex items-center gap-1.5">
          Value <TypeBadge type={typeToCql(vt)} />
        </span>
        <span />
      </div>
      <ul className="m-0 max-h-[240px] list-none overflow-auto p-0 px-2.5 py-1.5">
        {value.length === 0 && <li className="py-2 text-center text-xs text-muted">The map is empty.</li>}
        {value.map((p, i) => (
          <li key={i} className="mb-1.5 grid items-center gap-1.5" style={{ gridTemplateColumns: '1fr 1fr 22px' }}>
            <ElementInput
              type={kt}
              value={p[0]}
              label={`Key ${i}`}
              flagged={keys.indexOf(canonical(p[0])) !== i || keys.lastIndexOf(canonical(p[0])) !== i}
              onChange={(x) => onChange(value.map((o, n) => (n === i ? [x, o[1]] : o)))}
              onDrill={() => onDrill({ steps: [i, 0], label: `key ${i}` })}
            />
            <ElementInput
              type={vt}
              value={p[1]}
              label={`Value ${i}`}
              onChange={(x) => onChange(value.map((o, n) => (n === i ? [o[0], x] : o)))}
              onDrill={() => onDrill({ steps: [i, 1], label: formatCell(kt, p[0]) ?? `value ${i}` })}
            />
            <IconButton label={`Remove entry ${i}`} icon={<X size={12} />} onClick={() => onChange(value.filter((_, n) => n !== i))} />
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="m-0 px-2.5 pb-1 text-[11.5px] text-danger">
          {message}
        </p>
      )}
      <div className="px-2.5 pb-2">
        <Button variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...value, [newValue(kt, udtFields), newValue(vt, udtFields)]])}>
          Add entry
        </Button>
      </div>
    </div>
  )
}
