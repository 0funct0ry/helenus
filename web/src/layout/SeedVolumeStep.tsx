import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { Button } from '../ui/Button'
import { CONSISTENCIES, randomSeed } from '../lib/seedModel'
import type { SeedConfig, SeedFieldError } from '../api/types'

export interface SeedVolumeStepProps {
  config: SeedConfig
  errors: SeedFieldError[]
  /** Whether the table has clustering columns; without them every row is its own partition. */
  hasClustering: boolean
  counter: boolean
  partitions?: number
  onChange: (config: SeedConfig) => void
}

/**
 * Step 2 of the seed wizard: how many rows, rows per partition, write concurrency, consistency (ANY is not offered),
 * TTL, IF NOT EXISTS (with a "much slower" warning) and the random seed with a Randomize button.
 */
export function SeedVolumeStep({ config, errors, hasClustering, counter, partitions, onChange }: SeedVolumeStepProps) {
  const err = (f: string) => errors.find((e) => e.field === f)?.message
  const num = (k: keyof SeedConfig) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...config, [k]: e.target.value === '' ? 0 : Number(e.target.value) })
  const field = (label: string, k: keyof SeedConfig, disabled = false, hint?: string) => (
    <div>
      <Field label={label} value={String(config[k] ?? '')} onChange={num(k)} disabled={disabled} aria-invalid={!!err(k)} className="!mb-1" />
      {err(k) && (
        <p role="alert" className="m-0 text-xs text-danger">
          {err(k)}
        </p>
      )}
      {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {field('Total rows', 'total_rows')}
      {field(
        'Rows per partition',
        'rows_per_partition',
        !hasClustering,
        hasClustering ? (partitions ? `${partitions.toLocaleString()} partitions` : undefined) : 'No clustering columns: one row per partition.',
      )}
      {field('Concurrency', 'concurrency')}
      <div className="flex flex-col gap-[5px]">
        <Select
          aboveDialog
          label="Consistency"
          value={config.consistency}
          options={CONSISTENCIES.map((c) => ({ value: c, label: c }))}
          onChange={(consistency) => onChange({ ...config, consistency })}
        />
        {err('consistency') && (
          <p role="alert" className="m-0 text-xs text-danger">
            {err('consistency')}
          </p>
        )}
      </div>
      {field('TTL seconds (0 = none)', 'ttl', counter, counter ? 'Counter tables do not support TTL.' : undefined)}
      <div className="flex flex-col gap-1">
        <Toggle checked={config.if_not_exists} disabled={counter} onChange={(if_not_exists) => onChange({ ...config, if_not_exists })}>
          IF NOT EXISTS
        </Toggle>
        {config.if_not_exists && <p className="m-0 text-xs text-warn">Lightweight transactions are much slower.</p>}
        {err('if_not_exists') && (
          <p role="alert" className="m-0 text-xs text-danger">
            {err('if_not_exists')}
          </p>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Field label="Seed" value={String(config.seed)} className="!mb-0 flex-1" onChange={(e) => onChange({ ...config, seed: Number(e.target.value) || 0 })} />
        <Button onClick={() => onChange({ ...config, seed: randomSeed() })}>Randomize</Button>
      </div>
      <p className="col-span-2 m-0 text-xs text-muted">The same seed and settings always produce the same rows.</p>
    </div>
  )
}
