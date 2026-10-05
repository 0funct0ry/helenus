import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Lock, X } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { KeyMarker } from '../ui/KeyMarker'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { Field } from '../ui/Field'
import type { ViewDraft } from '../lib/viewDraft'
import type { Table } from '../lib/schemaModel'

export interface NewViewKeysStepProps {
  draft: ViewDraft
  onChange: (draft: ViewDraft) => void
  /** The base table; its key columns are locked in the view key and every other non-static column may be added. */
  base: Table | undefined
  /** Visible validation messages by planner field (`partition_key`, `clustering.1`, `extra_where`, …). */
  errors: Record<string, string>
}

const swap = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const out = [...list]
  ;[out[i], out[i + d]] = [out[i + d], out[i]]
  return out
}

interface ListProps {
  title: string
  kind: 'partition' | 'clustering'
  names: string[]
  locked: Set<string>
  errors: Record<string, string>
  errorPrefix: string
  onRemove: (i: number) => void
  onMove: (i: number, d: -1 | 1) => void
  extra?: (i: number) => ReactNode
}

function KeyList({ title, kind, names, locked, errors, errorPrefix, onRemove, onMove, extra }: ListProps) {
  return (
    <section aria-label={title} className="mb-4">
      <h3 className="mb-1 mt-0 text-[13px] font-semibold">{title}</h3>
      {errors[errorPrefix] && <p className="mb-1 mt-0 text-xs text-danger">{errors[errorPrefix]}</p>}
      <ul className="m-0 list-none p-0">
        {names.map((n, i) => (
          <li key={n} className="flex items-center gap-2 border-b border-line2 py-1.5">
            <span className="inline-flex w-[34px] shrink-0">
              <KeyMarker kind={kind} position={i + 1} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{n}</span>
            {extra?.(i)}
            <IconButton label={`Move ${n} up in ${title}`} icon={<ArrowUp size={13} />} disabled={i === 0} onClick={() => onMove(i, -1)} />
            <IconButton label={`Move ${n} down in ${title}`} icon={<ArrowDown size={13} />} disabled={i === names.length - 1} onClick={() => onMove(i, 1)} />
            {locked.has(n) ? (
              <span title="Base key columns must stay in the view key" role="img" aria-label={`${n} is locked`} className="inline-flex size-6 items-center justify-center text-muted">
                <Lock size={12} />
              </span>
            ) : (
              <IconButton label={`Remove ${n} from ${title}`} icon={<X size={13} />} onClick={() => onRemove(i)} />
            )}
            {errors[`${errorPrefix}.${i}`] && <span className="text-xs text-danger">{errors[`${errorPrefix}.${i}`]}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Step 2 of the New view wizard: the view's primary key. The base table's key columns are pre-placed in
 * their original positions and locked (they can be reordered but not removed). One extra non-key column
 * may be added to either list; adding more is allowed here so the planner can explain why it fails.
 * Clustering columns carry an ASC/DESC control. Also holds the optional extra WHERE restriction.
 */
export function NewViewKeysStep({ draft, onChange, base, errors }: NewViewKeysStepProps) {
  const locked = new Set((base?.columns ?? []).filter((c) => c.kind === 'partition' || c.kind === 'clustering').map((c) => c.name))
  const used = new Set([...draft.partitionKey, ...draft.clustering.map((c) => c.column)])
  const available = (base?.columns ?? []).filter((c) => c.kind !== 'static' && !used.has(c.name)).map((c) => ({ value: c.name, label: c.name }))
  const add = (section: string, onPick: (n: string) => void) =>
    available.length > 0 && (
      <Select aboveDialog aria-label={`Add to ${section}`} mono value="" options={[{ value: '', label: 'Add column…' }, ...available]} onChange={(v) => v && onPick(v)} />
    )
  return (
    <div>
      <KeyList
        title="Partition key"
        kind="partition"
        names={draft.partitionKey}
        locked={locked}
        errors={errors}
        errorPrefix="partition_key"
        onRemove={(i) => onChange({ ...draft, partitionKey: draft.partitionKey.filter((_, n) => n !== i) })}
        onMove={(i, d) => onChange({ ...draft, partitionKey: swap(draft.partitionKey, i, d) })}
      />
      {add('Partition key', (n) => onChange({ ...draft, partitionKey: [...draft.partitionKey, n] }))}
      <div className="mt-4" />
      <KeyList
        title="Clustering columns"
        kind="clustering"
        names={draft.clustering.map((c) => c.column)}
        locked={locked}
        errors={errors}
        errorPrefix="clustering"
        onRemove={(i) => onChange({ ...draft, clustering: draft.clustering.filter((_, n) => n !== i) })}
        onMove={(i, d) => onChange({ ...draft, clustering: swap(draft.clustering, i, d) })}
        extra={(i) => (
          <SegmentedControl
            label={`Order of ${draft.clustering[i].column}`}
            value={draft.clustering[i].order}
            options={[
              { value: 'ASC', label: 'ASC' },
              { value: 'DESC', label: 'DESC' },
            ]}
            onChange={(order) => onChange({ ...draft, clustering: draft.clustering.map((c, n) => (n === i ? { ...c, order } : c)) })}
          />
        )}
      />
      {add('Clustering columns', (column) => onChange({ ...draft, clustering: [...draft.clustering, { column, order: 'ASC' }] }))}
      <div className="mt-4" />
      <Field
        label="Extra WHERE restriction (optional)"
        mono
        value={draft.extraWhere}
        placeholder="e.g. total > 100"
        onChange={(e) => onChange({ ...draft, extraWhere: e.target.value })}
      />
      {errors.extra_where && <p className="-mt-2 mb-3 text-xs text-danger">{errors.extra_where}</p>}
      <p className="mt-0 text-xs text-muted">Appended after the IS NOT NULL terms exactly as typed; the server checks it.</p>
    </div>
  )
}
