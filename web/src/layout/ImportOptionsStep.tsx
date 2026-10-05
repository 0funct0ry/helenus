import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { CONSISTENCIES } from '../lib/seedModel'
import { validateImportOptions } from '../lib/importModel'
import type { ImportOptions } from '../api/types'

export interface ImportOptionsStepProps {
  options: ImportOptions
  onChange: (options: ImportOptions) => void
}

/**
 * Step 4 of the import wizard: consistency (ANY is not offered), TTL, IF NOT EXISTS (with a "much slower" warning),
 * write concurrency, batch size (batches only ever hold rows of one partition) and the number of rejected rows after
 * which the import aborts. Out-of-range values are flagged here and block Next.
 */
export function ImportOptionsStep({ options, onChange }: ImportOptionsStepProps) {
  const errors = validateImportOptions(options)
  const num = (k: keyof ImportOptions, label: string, hint?: string) => (
    <div>
      <Field
        label={label}
        value={String(options[k])}
        aria-invalid={!!errors[k]}
        className="!mb-1"
        onChange={(e) => onChange({ ...options, [k]: e.target.value === '' ? 0 : Number(e.target.value) })}
      />
      {errors[k] && (
        <p role="alert" className="m-0 text-xs text-danger">
          {errors[k]}
        </p>
      )}
      {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      <Select
        aboveDialog
        label="Consistency"
        value={options.consistency}
        options={CONSISTENCIES.map((c) => ({ value: c, label: c }))}
        onChange={(consistency) => onChange({ ...options, consistency })}
      />
      {num('ttl', 'TTL seconds (0 = none)')}
      <div className="flex flex-col gap-1">
        <Toggle checked={options.if_not_exists} onChange={(if_not_exists) => onChange({ ...options, if_not_exists })}>
          IF NOT EXISTS
        </Toggle>
        {options.if_not_exists && <p className="m-0 text-xs text-warn">Lightweight transactions are much slower.</p>}
      </div>
      {num('concurrency', 'Concurrency')}
      {num('batch_size', 'Batch size', 'Unlogged batches only group rows of the same partition. 1 writes each row on its own.')}
      {num('max_errors', 'Abort after rejected rows')}
      <p className="col-span-2 m-0 text-xs text-muted">Empty values are skipped rather than written as null, so no tombstones are created.</p>
    </div>
  )
}
