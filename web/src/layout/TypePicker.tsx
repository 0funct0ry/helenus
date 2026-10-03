import { Plus, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import type { SelectOption } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { COMPOSITE_TYPES, NATIVE_TYPES, UDT_PREFIX, isComposite, newDraft } from '../lib/typeBuilder'
import type { TypeDraft } from '../lib/typeBuilder'

export interface TypePickerProps {
  value: TypeDraft
  onChange: (value: TypeDraft) => void
  /** Names of the UDTs in the keyspace that can be used as a type. */
  udts: string[]
  /** Accessible name of this picker, e.g. "Type of lat"; nested pickers extend it. */
  label: string
}

/**
 * Type picker for UDT fields: a dropdown of scalar types, collections, tuple, vector and the keyspace's
 * UDTs. Choosing a collection, tuple or vector opens a nested picker per element type (tuples can grow or
 * shrink; vectors take a dimension), and a Frozen switch wraps the type in `frozen<…>`. The server adds
 * frozen<> where Cassandra requires it, so the switch only matters when the user wants it explicitly.
 */
export function TypePicker({ value, onChange, udts, label }: TypePickerProps) {
  const options: SelectOption[] = [
    ...NATIVE_TYPES.map((t) => ({ value: t, label: t })),
    ...COMPOSITE_TYPES.map((t) => ({ value: t, label: t === 'vector' ? 'vector<T, n>' : `${t}<…>` })),
    ...udts.map((u) => ({ value: UDT_PREFIX + u, label: u })),
  ]
  const pick = (base: string) => onChange({ ...newDraft(base), frozen: value.frozen })
  const setArg = (i: number, a: TypeDraft) => onChange({ ...value, args: value.args.map((x, n) => (n === i ? a : x)) })
  const argNames = value.base === 'map' ? ['key', 'value'] : value.base === 'tuple' ? value.args.map((_, i) => `element ${i + 1}`) : ['element']
  const frozenAllowed = isComposite(value.base) ? value.base !== 'vector' : value.base.startsWith(UDT_PREFIX)

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Select aboveDialog aria-label={label} mono value={value.base} options={options} onChange={pick} />
        {frozenAllowed && (
          <Toggle checked={value.frozen} onChange={(frozen) => onChange({ ...value, frozen })} aria-label={`${label} frozen`}>
            frozen
          </Toggle>
        )}
        {value.base === 'vector' && (
          <Input
            mono
            type="number"
            min={1}
            className="w-20 shrink-0"
            aria-label={`${label} dimension`}
            value={value.size || ''}
            onChange={(e) => onChange({ ...value, size: Number(e.target.value) })}
          />
        )}
      </div>
      {value.args.length > 0 && (
        <div className="ml-3 flex flex-col gap-1.5 border-l border-line2 pl-3">
          {value.args.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-[70px] shrink-0 pt-1 text-xs text-muted">{argNames[i]}</span>
              <TypePicker value={a} onChange={(x) => setArg(i, x)} udts={udts} label={`${label} ${argNames[i]}`} />
              {value.base === 'tuple' && value.args.length > 1 && (
                <IconButton
                  label={`Remove ${argNames[i]} of ${label}`}
                  icon={<X size={13} />}
                  onClick={() => onChange({ ...value, args: value.args.filter((_, n) => n !== i) })}
                />
              )}
            </div>
          ))}
          {value.base === 'tuple' && (
            <div>
              <Button variant="ghost" icon={<Plus size={13} />} onClick={() => onChange({ ...value, args: [...value.args, newDraft('text')] })}>
                Add element
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
