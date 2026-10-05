import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import type { SelectOption } from '../ui/Select'
import type { AggregateCandidate } from '../api/types'

export interface AggregateFunctionSelectProps {
  /** Accessible name and visible caption, e.g. "State function". */
  label: string
  /** Signature of the chosen function, or empty for none. */
  value: string
  candidates: AggregateCandidate[]
  /** Offer an empty "(none)" choice (FINALFUNC is optional). */
  optional?: boolean
  onChange: (signature: string) => void
  /** Opens the function editor prefilled with the signature this slot needs. */
  onCreate: () => void
}

/**
 * Dropdown of the functions that can fill an aggregate's SFUNC or FINALFUNC slot. Functions with a different
 * signature stay in the list, disabled, and say which signature the slot needs ("Needs (…) → …"). A
 * "Create function…" button next to it starts a new function with the right signature.
 */
export function AggregateFunctionSelect({ label, value, candidates, optional, onChange, onCreate }: AggregateFunctionSelectProps) {
  const options: SelectOption[] = [
    ...(optional ? [{ value: '', label: '(none)' }] : value === '' ? [{ value: '', label: 'Select a function…' }] : []),
    ...candidates.map((c) => ({
      value: c.signature,
      label: c.ok ? `${c.signature} → ${c.returns}` : `${c.signature} — ${c.reason ?? ''}`,
      disabled: !c.ok,
      title: c.reason,
    })),
  ]
  return (
    <div className="flex flex-col gap-[5px]">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <Select aria-label={label} mono aboveDialog value={value} options={options} onChange={onChange} className="min-w-0 max-w-[560px]" />
        <Button icon={<Plus size={14} />} onClick={onCreate}>
          Create function…
        </Button>
      </div>
    </div>
  )
}
