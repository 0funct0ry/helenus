import type { KeyboardEvent, ReactNode } from 'react'
import { Field } from '../ui/Field'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Toggle } from '../ui/Toggle'
import { DatacenterRows } from './DatacenterRows'
import type { DatacenterRow } from './DatacenterRows'
import type { KeyspaceRequest } from '../api/types'

export interface KeyspaceFormValue {
  name: string
  strategy: KeyspaceRequest['strategy']
  rf: number
  rows: DatacenterRow[]
  durable: boolean
}

export interface KeyspaceFormProps {
  value: KeyspaceFormValue
  onChange: (patch: Partial<KeyspaceFormValue>) => void
  /** Validation messages keyed by plan field, already filtered for visibility. */
  errors: Record<string, string>
  /** Show the name as read-only text (edit mode). */
  nameReadOnly?: boolean
  onNameBlur?: () => void
  onNameEnter?: () => void
  /** Extra toggles rendered under Durable writes (for example "Create only if it doesn't exist"). */
  extraToggles?: ReactNode
}

/**
 * The shared keyspace form: name, replication strategy (SimpleStrategy factor or a datacenter table),
 * and durable writes. Fully controlled; the create and edit dialogs own the state and the live preview.
 */
export function KeyspaceForm({ value, onChange, errors, nameReadOnly, onNameBlur, onNameEnter, extraToggles }: KeyspaceFormProps) {
  const { name, strategy, rf, rows, durable } = value
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && onNameEnter) {
      e.preventDefault()
      onNameEnter()
    }
  }
  return (
    <>
      <Field
        label="Name"
        mono
        autoFocus={!nameReadOnly}
        readOnly={nameReadOnly}
        value={name}
        placeholder="shop"
        aria-invalid={!!errors.name}
        onChange={(e) => onChange({ name: e.target.value })}
        onBlur={onNameBlur}
        onKeyDown={onKey}
      />
      {errors.name && <p className="-mt-2 mb-3 text-xs text-danger">{errors.name}</p>}
      <div className="mb-3 flex flex-col gap-[5px]">
        <span className="text-xs text-muted">Replication strategy</span>
        <SegmentedControl
          label="Replication strategy"
          value={strategy}
          onChange={(s) => onChange({ strategy: s })}
          options={[
            { value: 'SimpleStrategy', label: 'SimpleStrategy' },
            { value: 'NetworkTopologyStrategy', label: 'NetworkTopologyStrategy' },
          ]}
        />
      </div>
      {strategy === 'SimpleStrategy' ? (
        <>
          <Field
            label="Replication factor"
            type="number"
            min={1}
            max={20}
            value={Number.isNaN(rf) ? '' : rf}
            aria-invalid={!!errors.replication_factor}
            onChange={(e) => onChange({ rf: e.target.value === '' ? NaN : Number(e.target.value) })}
          />
          {errors.replication_factor && <p className="-mt-2 mb-3 text-xs text-danger">{errors.replication_factor}</p>}
        </>
      ) : (
        <div className="mb-3">
          <span className="mb-[5px] block text-xs text-muted">Datacenters</span>
          <DatacenterRows rows={rows} errors={errors} onChange={(r) => onChange({ rows: r })} />
        </div>
      )}
      <div className="mb-3 flex flex-col items-start gap-1">
        <Toggle checked={durable} onChange={(d) => onChange({ durable: d })}>
          Durable writes
        </Toggle>
        {extraToggles}
      </div>
    </>
  )
}
