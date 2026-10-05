import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import type { AlterTableOptions } from '../api/types'

export interface TableOptionsPanelProps {
  /** Current options as CQL literals, keyed by option name. */
  options: Record<string, string>
  /** Server major version (for example 5); gates Unified compaction (5+), Zstd (4+) and read_repair (4+). */
  serverMajor: number
  /** Called with only the options the user changed when "Review changes…" is pressed. */
  onReview: (alter: AlterTableOptions) => void
}

const COMPACTIONS = ['SizeTieredCompactionStrategy', 'LeveledCompactionStrategy', 'TimeWindowCompactionStrategy']
const COMPRESSIONS = ['LZ4Compressor', 'SnappyCompressor', 'DeflateCompressor']

const unquote = (v: string | undefined) => (v ?? '').replace(/^'|'$/g, '').replace(/''/g, "'")
const short = (v: string | undefined) => unquote(v).split('.').pop() ?? ''

/**
 * The Options panel of the Schema edit mode: comment, default TTL, gc_grace_seconds, compaction,
 * compression, caching, speculative retry and (4.x+) read repair. Fields start from the table's current
 * values; "Review changes…" hands the touched ones to the caller, which opens the statement preview.
 */
export function TableOptionsPanel({ options, serverMajor, onReview }: TableOptionsPanelProps) {
  const [edit, setEdit] = useState<Record<string, string>>({})
  const cur: Record<string, string> = {
    comment: unquote(options.comment),
    ttl: options.default_time_to_live ?? '0',
    gc: options.gc_grace_seconds ?? '',
    bloom: options.bloom_filter_fp_chance ?? '',
    compaction: short(options.compaction?.match(/'class': '([^']+)'/)?.[1]) || 'SizeTieredCompactionStrategy',
    compression: options.compression?.includes("'enabled': 'false'") ? 'none' : short(options.compression?.match(/'class': '([^']+)'/)?.[1]) || 'LZ4Compressor',
    keys: options.caching?.match(/'keys': '([^']+)'/)?.[1] ?? 'ALL',
    rows: options.caching?.match(/'rows_per_partition': '([^']+)'/)?.[1] ?? 'NONE',
    spec: unquote(options.speculative_retry),
    rr: unquote(options.read_repair) || 'BLOCKING',
  }
  const v = (k: string) => edit[k] ?? cur[k]
  const set = (k: string, val: string) => setEdit((e) => ({ ...e, [k]: val }))
  const touched = (k: string) => k in edit && edit[k] !== cur[k]
  const num = (k: string) => (v(k).trim() === '' ? -1 : Number(v(k)))
  const compactions = [...COMPACTIONS, ...(serverMajor >= 5 ? ['UnifiedCompactionStrategy'] : [])]
  const compressions = [...COMPRESSIONS, ...(serverMajor >= 4 ? ['ZstdCompressor'] : []), 'none']
  const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }))

  const review = () => {
    const a: AlterTableOptions = {}
    if (touched('comment')) a.comment = v('comment')
    if (touched('ttl')) a.default_ttl_seconds = num('ttl')
    if (touched('gc')) a.gc_grace_seconds = num('gc')
    if (touched('bloom')) a.bloom_filter_fp_chance = num('bloom')
    if (touched('compaction')) a.compaction = { class: v('compaction') }
    if (touched('compression')) a.compression = { class: v('compression') }
    if (touched('keys') || touched('rows')) a.caching = { keys: v('keys'), rows_per_partition: v('rows') }
    if (touched('spec')) a.speculative_retry = v('spec')
    if (touched('rr')) a.read_repair = v('rr')
    onReview(a)
  }

  return (
    <section aria-label="Edit options" className="rounded-md border border-line2 p-3">
      <Field label="Comment" value={v('comment')} onChange={(e) => set('comment', e.target.value)} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Default TTL (seconds)" type="number" min={0} mono value={v('ttl')} onChange={(e) => set('ttl', e.target.value)} />
        <Field label="gc_grace_seconds" type="number" min={0} mono value={v('gc')} onChange={(e) => set('gc', e.target.value)} />
        <Field label="Bloom filter chance" type="number" step="0.01" mono value={v('bloom')} onChange={(e) => set('bloom', e.target.value)} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select label="Compaction" value={v('compaction')} options={opts(compactions)} onChange={(x) => set('compaction', x)} />
        <Select label="Compression" value={v('compression')} options={opts(compressions)} onChange={(x) => set('compression', x)} />
        <Select label="Caching keys" value={v('keys')} options={opts(['ALL', 'NONE'])} onChange={(x) => set('keys', x)} />
        {serverMajor >= 4 && <Select label="Read repair" value={v('rr')} options={opts(['BLOCKING', 'NONE'])} onChange={(x) => set('rr', x)} />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rows per partition (NONE, ALL or a number)" mono value={v('rows')} onChange={(e) => set('rows', e.target.value)} />
        <Field label="Speculative retry (for example 99p)" mono value={v('spec')} onChange={(e) => set('spec', e.target.value)} />
      </div>
      <Button onClick={review}>Review changes…</Button>
    </section>
  )
}
