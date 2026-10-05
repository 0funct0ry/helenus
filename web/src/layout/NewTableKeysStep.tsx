import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { KeyMarker } from '../ui/KeyMarker'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import type { TableDraft } from '../lib/tableDraft'

export interface NewTableKeysStepProps {
  draft: TableDraft
  onChange: (draft: TableDraft) => void
  /** Visible validation messages by planner field (`partition_key`, `partition_key.0`, `clustering.1`, …). */
  errors: Record<string, string>
}

interface KeyListProps {
  title: string
  kind: 'partition' | 'clustering'
  ids: number[]
  draft: TableDraft
  available: { value: string; label: string }[]
  errors: Record<string, string>
  errorPrefix: string
  onAdd: (id: number) => void
  onRemove: (index: number) => void
  onMove: (index: number, delta: -1 | 1) => void
  /** Rendered after the name of each entry, e.g. the ASC/DESC control. */
  extra?: (index: number) => ReactNode
}

function KeyList({ title, kind, ids, draft, available, errors, errorPrefix, onAdd, onRemove, onMove, extra }: KeyListProps) {
  const name = (id: number) => draft.columns.find((c) => c.id === id)?.name ?? ''
  return (
    <section aria-label={title} className="mb-4">
      <h3 className="mb-1 mt-0 text-[13px] font-semibold">{title}</h3>
      {errors[errorPrefix] && <p className="mb-1 mt-0 text-xs text-danger">{errors[errorPrefix]}</p>}
      <ul className="m-0 list-none p-0">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-2 border-b border-line2 py-1.5">
            <span className="inline-flex w-[34px] shrink-0">
              <KeyMarker kind={kind} position={i + 1} order={kind === 'clustering' ? draft.clustering[i]?.order : undefined} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{name(id)}</span>
            {extra?.(i)}
            <IconButton label={`Move ${name(id)} up in ${title}`} icon={<ArrowUp size={13} />} disabled={i === 0} onClick={() => onMove(i, -1)} />
            <IconButton label={`Move ${name(id)} down in ${title}`} icon={<ArrowDown size={13} />} disabled={i === ids.length - 1} onClick={() => onMove(i, 1)} />
            <IconButton label={`Remove ${name(id)} from ${title}`} icon={<X size={13} />} onClick={() => onRemove(i)} />
            {errors[`${errorPrefix}.${i}`] && <span className="text-xs text-danger">{errors[`${errorPrefix}.${i}`]}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        {available.length > 0 ? (
          <Select aboveDialog aria-label={`Add to ${title}`} mono value="" options={[{ value: '', label: 'Add column…' }, ...available]} onChange={(v) => v && onAdd(Number(v))} />
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Plus size={12} /> No columns left to add
          </span>
        )}
      </div>
    </section>
  )
}

const swap = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const out = [...list]
  ;[out[i], out[i + d]] = [out[i + d], out[i]]
  return out
}

/**
 * Step 2 of the New table wizard: choose the partition key (ordered) and clustering columns (ordered, each
 * ASC or DESC) from the columns of step 1. A column can be in only one place, so chosen columns disappear
 * from the "Add column…" menus; entries show the KeyMarker used in the schema tree.
 */
export function NewTableKeysStep({ draft, onChange, errors }: NewTableKeysStepProps) {
  const used = new Set([...draft.partitionKey, ...draft.clustering.map((c) => c.id)])
  const available = draft.columns.filter((c) => c.name !== '' && !used.has(c.id)).map((c) => ({ value: String(c.id), label: c.name }))
  return (
    <div>
      <KeyList
        title="Partition key"
        kind="partition"
        ids={draft.partitionKey}
        draft={draft}
        available={available}
        errors={errors}
        errorPrefix="partition_key"
        onAdd={(id) => onChange({ ...draft, partitionKey: [...draft.partitionKey, id] })}
        onRemove={(i) => onChange({ ...draft, partitionKey: draft.partitionKey.filter((_, n) => n !== i) })}
        onMove={(i, d) => onChange({ ...draft, partitionKey: swap(draft.partitionKey, i, d) })}
      />
      <KeyList
        title="Clustering columns"
        kind="clustering"
        ids={draft.clustering.map((c) => c.id)}
        draft={draft}
        available={available}
        errors={errors}
        errorPrefix="clustering"
        onAdd={(id) => onChange({ ...draft, clustering: [...draft.clustering, { id, order: 'ASC' }] })}
        onRemove={(i) => onChange({ ...draft, clustering: draft.clustering.filter((_, n) => n !== i) })}
        onMove={(i, d) => onChange({ ...draft, clustering: swap(draft.clustering, i, d) })}
        extra={(i) => (
          <SegmentedControl
            label={`Order of ${draft.columns.find((c) => c.id === draft.clustering[i].id)?.name ?? ''}`}
            value={draft.clustering[i].order}
            options={[
              { value: 'ASC', label: 'ASC' },
              { value: 'DESC', label: 'DESC' },
            ]}
            onChange={(order) => onChange({ ...draft, clustering: draft.clustering.map((c, n) => (n === i ? { ...c, order } : c)) })}
          />
        )}
      />
    </div>
  )
}
