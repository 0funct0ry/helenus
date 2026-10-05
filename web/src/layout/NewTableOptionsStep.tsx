import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { DEFAULT_OPTIONS, TTL_UNITS } from '../lib/tableDraft'
import type { OptionsDraft, TtlUnit } from '../lib/tableDraft'

export interface NewTableOptionsStepProps<D extends { options: OptionsDraft } = { options: OptionsDraft }> {
  draft: D
  onChange: (draft: D) => void
  /** Server major version (for example 5); gates UnifiedCompactionStrategy (5+) and ZstdCompressor (4+). */
  serverMajor: number
  /** Visible validation messages by planner field (`comment`, `default_ttl_seconds`, …). */
  errors: Record<string, string>
}

/**
 * Step 3 of the New table wizard: optional table settings (comment, default TTL with a unit helper,
 * gc_grace_seconds, compaction, compression, bloom filter chance), collapsed under "Defaults are fine for
 * most tables". Also used by the New view wizard. Version-gated choices are omitted for older servers. "Reset to defaults" clears them all.
 */
export function NewTableOptionsStep<D extends { options: OptionsDraft }>({ draft, onChange, serverMajor, errors }: NewTableOptionsStepProps<D>) {
  const [expanded, setExpanded] = useState(false)
  const o = draft.options
  const set = (patch: Partial<typeof o>) => onChange({ ...draft, options: { ...o, ...patch } })
  const compactions = ['SizeTieredCompactionStrategy', 'LeveledCompactionStrategy', 'TimeWindowCompactionStrategy', ...(serverMajor >= 5 ? ['UnifiedCompactionStrategy'] : [])]
  const compressions = ['LZ4Compressor', 'SnappyCompressor', 'DeflateCompressor', ...(serverMajor >= 4 ? ['ZstdCompressor'] : []), 'none']
  const err = (f: string) => errors[f] && <p className="-mt-2 mb-3 text-xs text-danger">{errors[f]}</p>
  return (
    <div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="mb-3 flex items-center gap-1 text-[13px] font-semibold">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Defaults are fine for most tables
      </button>
      {expanded && (
        <div>
          <Field label="Comment" value={o.comment} onChange={(e) => set({ comment: e.target.value })} />
          {err('comment')}
          <div className="mb-3 flex items-end gap-2">
            <Field className="mb-0 flex-1" label="Default TTL" type="number" min={0} mono value={o.ttl} placeholder="0 (no expiry)" onChange={(e) => set({ ttl: e.target.value })} />
            <Select
              aboveDialog
              aria-label="TTL unit"
              value={o.ttlUnit}
              options={(Object.keys(TTL_UNITS) as TtlUnit[]).map((u) => ({ value: u, label: u }))}
              onChange={(ttlUnit) => set({ ttlUnit: ttlUnit as TtlUnit })}
            />
          </div>
          {err('default_ttl_seconds')}
          <Field label="gc_grace_seconds" type="number" min={0} mono value={o.gcGrace} placeholder="864000" onChange={(e) => set({ gcGrace: e.target.value })} />
          {err('gc_grace_seconds')}
          <div className="mb-3 flex flex-col gap-[5px]">
            <span className="text-xs text-muted">Compaction</span>
            <Select aboveDialog aria-label="Compaction" mono value={o.compaction} options={compactions.map((c) => ({ value: c, label: c }))} onChange={(compaction) => set({ compaction })} />
            {err('compaction')}
          </div>
          <div className="mb-3 flex flex-col gap-[5px]">
            <span className="text-xs text-muted">Compression</span>
            <Select aboveDialog aria-label="Compression" mono value={o.compression} options={compressions.map((c) => ({ value: c, label: c }))} onChange={(compression) => set({ compression })} />
            {err('compression')}
          </div>
          <Field label="Bloom filter false-positive chance" type="number" step="any" mono value={o.bloom} placeholder="0.01" onChange={(e) => set({ bloom: e.target.value })} />
          {err('bloom_filter_fp_chance')}
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => onChange({ ...draft, options: { ...DEFAULT_OPTIONS } })}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  )
}
