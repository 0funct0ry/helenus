import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { SegmentedControl } from '../ui/SegmentedControl'
import { ExportColumnList } from './ExportColumnList'
import { ExportFormatOptions } from './ExportFormatOptions'
import { ExportPresetBar } from './ExportPresetBar'
import { ExportRunView } from './ExportRunView'
import { describeError } from '../api/client'
import { useSchema } from '../api/hooks'
import { exportFileUrl, startExport } from '../api/useExport'
import { useCancelJob, useJob } from '../api/useSeed'
import { useWorkspace } from '../store/workspace'
import { applyPreset, defaultExportFilename, DEFAULT_EXPORT_OPTIONS, EXPORT_FORMATS, extensionOf, presetColumns } from '../lib/exportModel'
import type { ExportFormat, ExportOptions, ExportPreset, ExportSource } from '../api/types'

export interface ExportDialogProps {
  source: ExportSource
  onClose: () => void
}

/**
 * "Export…" dialog for a table or a query result: source summary, format segmented control, only the options of the
 * chosen format, a column checklist and token-range split (tables only), preset controls, and the file name (default
 * `<table>-<yyyyMMdd-HHmm>.<ext>`). Export starts a background job, shows its progress and downloads the file when it
 * finishes; Cancel deletes the partial file. Loading a preset unchecks columns this table lacks and lists them.
 * System keyspace tables export too (credential columns are masked by the server). Mount it only while open.
 */
export function ExportDialog({ source, onClose }: ExportDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const { data: keyspaces } = useSchema(profileId, true)
  const isTable = source.kind === 'table'
  const tableName = isTable ? source.table : ''

  const columns = useMemo(() => {
    if (!isTable) return []
    const ks = keyspaces?.find((k) => k.name === source.keyspace)
    return ks?.tables.find((t) => t.name === source.table)?.columns ?? ks?.views.find((v) => v.name === source.table)?.columns ?? []
  }, [keyspaces, source, isTable])
  const names = useMemo(() => columns.map((c) => c.name), [columns])

  const [format, setFormat] = useState<ExportFormat>('csv')
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [ranges, setRanges] = useState('1')
  const [notes, setNotes] = useState<string[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobFilename, setJobFilename] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const downloaded = useRef(false)

  const { data: job } = useJob(profileId, jobId)
  const cancel = useCancelJob(profileId)
  const checked = selected ?? names
  const shownName = filename ?? defaultExportFilename(tableName, format)

  useEffect(() => {
    if (job?.state === 'done' && jobId && !downloaded.current) {
      downloaded.current = true
      const a = document.createElement('a')
      a.href = exportFileUrl(profileId, jobId)
      a.download = jobFilename
      a.click()
    }
  }, [job, jobId, jobFilename, profileId])

  const loadPreset = (p: ExportPreset) => {
    const r = applyPreset(p, names)
    setFormat(r.format)
    setOptions(r.options)
    if (isTable) setSelected(r.selected)
    setNotes(r.missing.length ? [`Not in this table, unchecked: ${r.missing.join(', ')}`] : [])
  }

  const start = async () => {
    setStarting(true)
    setError(null)
    const n = Number(ranges)
    try {
      const res = await startExport(profileId, {
        source,
        format,
        options,
        columns: isTable && checked.length < names.length ? checked : undefined,
        filename: filename ?? '',
        ranges: isTable && n > 1 ? n : undefined,
      })
      downloaded.current = false
      setJobFilename(res.filename)
      setJobId(res.id)
    } catch (e) {
      setError(describeError(e))
    }
    setStarting(false)
  }

  const rangesValid = /^\d+$/.test(ranges) && Number(ranges) >= 1 && Number(ranges) <= 64
  const canStart = !starting && rangesValid && (!isTable || checked.length > 0)

  return (
    <Dialog
      open
      onClose={onClose}
      title="Export data"
      width="min(560px, 96vw)"
      footer={
        jobId ? undefined : (
          <>
            <div className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canStart} onClick={() => void start()}>
              Export
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 px-5 py-3 text-[13px]">
        <p className="m-0 text-muted">
          {isTable ? (
            <>
              Source: table <span className="font-mono text-fg">{source.keyspace}.{source.table}</span>
            </>
          ) : (
            <>
              Source: query result <span className="block max-h-12 overflow-hidden font-mono text-xs text-fg">{source.cql}</span>
            </>
          )}
        </p>
        {jobId ? (
          <ExportRunView job={job} filename={jobFilename} onCancel={() => cancel.mutate(jobId)} onClose={onClose} />
        ) : (
          <>
            <ExportPresetBar profile={profileId} format={format} options={options} columns={isTable ? presetColumns(checked, names) : null} onLoad={loadPreset} />
            {notes.map((n) => (
              <p key={n} className="m-0 text-xs text-warn">
                {n}
              </p>
            ))}
            <SegmentedControl label="Format" options={EXPORT_FORMATS.map((f) => ({ value: f.value, label: f.label }))} value={format} onChange={setFormat} />
            <ExportFormatOptions format={format} options={options} onChange={setOptions} />
            {isTable && columns.length > 0 && <ExportColumnList columns={columns} selected={checked} onChange={setSelected} />}
            {isTable && (
              <Field label="Token-range split (1–64 parallel ranges)" className="mb-0" inputMode="numeric" value={ranges} aria-invalid={!rangesValid} onChange={(e) => setRanges(e.target.value)} />
            )}
            <Field label="File name" mono className="mb-0" value={shownName} placeholder={`.${extensionOf(format)}`} onChange={(e) => setFilename(e.target.value)} />
            {error && (
              <p role="alert" className="m-0 text-danger">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
