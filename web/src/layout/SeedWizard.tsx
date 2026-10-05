import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { SeedGeneratorsStep } from './SeedGeneratorsStep'
import { SeedVolumeStep } from './SeedVolumeStep'
import { SeedPreviewStep } from './SeedPreviewStep'
import { SeedRunStep } from './SeedRunStep'
import { SeedProfilesBar } from './SeedProfilesBar'
import { SeedSaveProfileDialog } from './SeedSaveProfileDialog'
import { describeError } from '../api/client'
import { useSchema } from '../api/hooks'
import { previewSeed, startSeed, useCancelJob, useJob, useSeedPreview } from '../api/useSeed'
import { useWorkspace } from '../store/workspace'
import { newSeedConfig } from '../lib/seedModel'
import type { SeedConfig, SeedProfile, TypeDesc } from '../api/types'

export interface SeedWizardProps {
  keyspace: string
  table: string
  onClose: () => void
}

const STEPS = ['Generators', 'Volume', 'Preview', 'Run']

/**
 * "Seed data…" wizard: Generators, Volume, Preview, Run. The server returns the defaults-filled configuration and a
 * live preview (20 rows plus a sample statement) for every change, and reports field errors, which block Next. Run
 * starts a background job and polls it every 500 ms. Saved profiles load through the server so columns that changed
 * since are reset to defaults with a note. Closing before the run with edits asks for confirmation; closing during a
 * run leaves the job going (see the Jobs indicator). Mount it only while open.
 */
export function SeedWizard({ keyspace, table, onClose }: SeedWizardProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const open = useWorkspace((s) => s.open)
  const { data: keyspaces } = useSchema(profileId, true)
  const [config, setConfig] = useState<SeedConfig>(newSeedConfig)
  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)
  const [edited, setEdited] = useState(false)
  const [loadNote, setLoadNote] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const bumped = useRef(false)

  const { preview, pending } = useSeedPreview(profileId, keyspace, table, config)
  const { data: job } = useJob(profileId, jobId)
  const cancel = useCancelJob(profileId)

  // Adopt the server's per-column defaults for columns the draft has no generator for yet.
  useEffect(() => {
    if (!preview) return
    if (preview.columns.some((c) => !config.columns[c.name])) setConfig((c) => ({ ...c, columns: { ...preview.config.columns, ...c.columns } }))
  }, [preview, config.columns])

  useEffect(() => {
    if (job && job.state !== 'running' && !bumped.current) {
      bumped.current = true
      useWorkspace.getState().bumpDataEpoch()
    }
  }, [job])

  const update = (c: SeedConfig) => {
    setEdited(true)
    setConfig(c)
  }
  const columns = preview?.columns ?? []
  const errors = preview?.errors ?? []
  const colErrors = errors.filter((e) => e.field.startsWith('columns.'))
  const volErrors = errors.filter((e) => !e.field.startsWith('columns.'))
  const stepBlocked = pending || !preview || (step === 1 && colErrors.length > 0) || (step === 2 && volErrors.length > 0) || (step === 3 && errors.length > 0)
  const ready = !!preview && !pending && errors.length === 0 && columns.length > 0
  const hasClustering = columns.some((c) => c.kind === 'clustering')
  const counter = !!preview?.counter

  const udtFields = useMemo(
    () => (t: TypeDesc) => {
      if (!t.udt) return []
      const u = keyspaces?.find((k) => k.name === t.udt!.keyspace)?.types.find((x) => x.name === t.udt!.name)
      return u?.fields.map((f) => ({ name: f.name, desc: f.desc })) ?? []
    },
    [keyspaces],
  )

  const goto = (n: number) => {
    setStep(n)
    setReached((r) => Math.max(r, n))
  }
  const requestClose = () => (edited && !jobId ? setConfirmDiscard(true) : onClose())

  const loadProfile = async (p: SeedProfile) => {
    try {
      const res = await previewSeed(profileId, keyspace, table, p.config)
      setConfig(res.config)
      setLoadNote(res.notes)
    } catch (e) {
      setLoadNote([describeError(e)])
    }
    setEdited(true)
  }

  const start = async () => {
    setStarting(true)
    setStartError(null)
    try {
      const res = await startSeed(profileId, keyspace, table, config)
      setJobId(res.id)
    } catch (e) {
      setStartError(describeError(e))
    }
    setStarting(false)
  }

  const body = (() => {
    if (!preview) return <p className="text-muted">Reading the table…</p>
    switch (step) {
      case 1:
        return (
          <>
            <SeedProfilesBar profile={profileId} keyspace={keyspace} table={table} onLoad={(p) => void loadProfile(p)} onSave={() => setSaving(true)} />
            {[...loadNote, ...preview.notes].map((n) => (
              <p key={n} className="mb-2 mt-0 text-xs text-warn">
                {n}
              </p>
            ))}
            <SeedGeneratorsStep columns={columns} config={config} errors={colErrors} rows={preview.rows} udtFields={udtFields} onChange={update} />
          </>
        )
      case 2:
        return <SeedVolumeStep config={config} errors={volErrors} hasClustering={hasClustering} counter={counter} partitions={preview.partitions} onChange={update} />
      case 3:
        return <SeedPreviewStep columns={columns} rows={preview.rows} statement={preview.statement} notes={preview.notes} pending={pending} />
      default:
        return (
          <SeedRunStep
            job={job}
            starting={starting}
            startError={startError}
            totalRows={config.total_rows}
            canStart={ready}
            onStart={() => void start()}
            onCancel={() => jobId && cancel.mutate(jobId)}
            onOpenTable={() => {
              open('table', keyspace, table)
              onClose()
            }}
          />
        )
    }
  })()

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title={`Seed ${keyspace}.${table}`}
        width="min(960px, 94vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button onClick={requestClose}>{jobId ? 'Close' : 'Cancel'}</Button>
            <Button disabled={step === 1 || !!jobId} onClick={() => goto(step - 1)}>
              Back
            </Button>
            {step < 4 && (
              <Button variant="primary" disabled={stepBlocked} onClick={() => goto(step + 1)}>
                Next
              </Button>
            )}
          </>
        }
      >
        <ol aria-label="Steps" className="m-0 flex list-none gap-4 border-b border-line2 px-5 py-2">
          {STEPS.map((label, i) => {
            const n = i + 1
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={n > reached || !!jobId}
                  aria-current={n === step ? 'step' : undefined}
                  onClick={() => goto(n)}
                  className={`flex items-center gap-1.5 text-[13px] disabled:text-faint ${n === step ? 'font-semibold' : 'text-muted'}`}
                >
                  {n} {label}
                  {n !== step && n <= reached && (n === 1 ? colErrors : n === 2 ? volErrors : []).length > 0 && (
                    <span role="img" aria-label={`${label} has errors`} className="h-1.5 w-1.5 rounded-full bg-danger" />
                  )}
                </button>
              </li>
            )
          })}
        </ol>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-3">{body}</div>
      </Dialog>
      {saving && <SeedSaveProfileDialog profile={profileId} keyspace={keyspace} table={table} config={config} onSaved={() => setEdited(true)} onClose={() => setSaving(false)} />}
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard these settings?"
        message="The generators and settings you changed will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
