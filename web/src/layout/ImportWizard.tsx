import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ImportUploadStep } from './ImportUploadStep'
import { ImportFormatStep } from './ImportFormatStep'
import { ImportMappingStep } from './ImportMappingStep'
import { ImportOptionsStep } from './ImportOptionsStep'
import { ImportDryRunStep } from './ImportDryRunStep'
import { ImportRunStep } from './ImportRunStep'
import { describeError } from '../api/client'
import { dryRunImport, importErrorsUrl, planImport, startImport, uploadImport } from '../api/useImport'
import { useCancelJob, useJob } from '../api/useSeed'
import { useWorkspace } from '../store/workspace'
import { defaultImportOptions, formatFromDetect, validateImportOptions } from '../lib/importModel'
import type { ImportDryRun, ImportFormat, ImportMapping, ImportOptions, ImportResult, ImportUploadResult } from '../api/types'

export interface ImportWizardProps {
  keyspace: string
  table: string
  onClose: () => void
}

const STEPS = ['Upload', 'Format', 'Mapping', 'Options', 'Dry run', 'Run']

/**
 * "Import…" wizard: Upload, Format, Mapping, Options, Dry run, Run. The file goes to the server once; every format or
 * mapping change re-plans against it (detection, automatic column mapping, per-column type checks) without uploading
 * again. Next is blocked while the plan reports problems such as a primary key column with no source. Run starts a
 * background job polled every 500 ms; closing the dialog during a run leaves the job going. Mount it only while open.
 */
export function ImportWizard({ keyspace, table, onClose }: ImportWizardProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const open = useWorkspace((s) => s.open)
  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)
  const [upload, setUpload] = useState<ImportUploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [format, setFormat] = useState<ImportFormat | null>(null)
  const [mapping, setMapping] = useState<ImportMapping[] | null>(null)
  const [options, setOptions] = useState<ImportOptions>(defaultImportOptions)
  const [dryRows, setDryRows] = useState(100)
  const [dry, setDry] = useState<ImportDryRun>()
  const [dryRunning, setDryRunning] = useState(false)
  const [dryError, setDryError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const bumped = useRef(false)

  const { data: plan, error: planError } = useQuery({
    queryKey: ['import-plan', profileId, upload?.upload, keyspace, table, format, mapping],
    enabled: !!upload && !!format,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => planImport(profileId, { upload: upload!.upload, keyspace, table, format: format!, mapping }, signal),
  })
  const { data: job } = useJob(profileId, jobId)
  const cancel = useCancelJob(profileId)

  useEffect(() => {
    if (job && job.state !== 'running' && !bumped.current) {
      bumped.current = true
      useWorkspace.getState().bumpDataEpoch()
    }
  }, [job])

  const request = () => ({ upload: upload!.upload, keyspace, table, format: format!, mapping: plan ? plan.columns.map((c) => ({ target: c.target, source: c.source })) : mapping, options })

  const onFile = async (file: File) => {
    setUploading(true)
    setProgress(0)
    setUploadError(null)
    try {
      const res = await uploadImport(profileId, file, setProgress)
      setUpload(res)
      setFormat(formatFromDetect(res.detect))
      setMapping(null)
      setDry(undefined)
    } catch (e) {
      setUploadError(describeError(e))
    }
    setUploading(false)
  }

  const changeFormat = (f: ImportFormat) => {
    setFormat(f)
    setMapping(null)
    setDry(undefined)
  }
  const changeMapping = (m: ImportMapping[]) => {
    setMapping(m)
    setDry(undefined)
  }

  const runDry = async () => {
    setDryRunning(true)
    setDryError(null)
    try {
      setDry(await dryRunImport(profileId, { ...request(), rows: dryRows }))
    } catch (e) {
      setDryError(describeError(e))
    }
    setDryRunning(false)
  }
  const dryOnEntry = useRef(false)
  useEffect(() => {
    if (step === 5 && !dry && !dryRunning && !dryOnEntry.current && plan && plan.errors.length === 0) {
      dryOnEntry.current = true
      void runDry()
    }
    // runDry is recreated every render; entering the step once is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, plan])

  const start = async () => {
    setStarting(true)
    setStartError(null)
    try {
      const res = await startImport(profileId, request())
      setJobId(res.id)
    } catch (e) {
      setStartError(describeError(e))
    }
    setStarting(false)
  }

  const optionErrors = Object.keys(validateImportOptions(options)).length > 0
  const planErrors = plan?.errors ?? []
  const blocked =
    (step === 1 && (!upload || uploading)) ||
    (step === 2 && (!plan || plan.preview.length === 0)) ||
    (step === 3 && (!plan || planErrors.length > 0)) ||
    (step === 4 && optionErrors)
  const goto = (n: number) => {
    setStep(n)
    setReached((r) => Math.max(r, n))
  }
  const requestClose = () => (upload && !jobId ? setConfirmDiscard(true) : onClose())
  const result = job?.result && 'written' in job.result ? (job.result as ImportResult) : undefined

  const body = (() => {
    switch (step) {
      case 1:
        return <ImportUploadStep uploaded={upload} uploading={uploading} progress={progress} error={uploadError} onFile={(f) => void onFile(f)} />
      case 2:
        return format && <ImportFormatStep format={format} columns={plan?.source_columns ?? []} preview={plan?.preview ?? []} onChange={changeFormat} />
      case 3:
        return plan ? <ImportMappingStep columns={plan.columns} sourceColumns={plan.source_columns} errors={planErrors} onChange={changeMapping} /> : <p className="text-muted">Reading the file…</p>
      case 4:
        return <ImportOptionsStep options={options} onChange={setOptions} />
      case 5:
        return <ImportDryRunStep rows={dryRows} onRowsChange={setDryRows} result={dry} running={dryRunning} error={dryError} onRun={() => void runDry()} />
      default:
        return (
          <ImportRunStep
            job={job}
            starting={starting}
            startError={startError}
            canStart={!!plan && planErrors.length === 0 && !optionErrors}
            errorsUrl={jobId && result?.rejected ? importErrorsUrl(profileId, jobId) : null}
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
        title={`Import into ${keyspace}.${table}`}
        width="min(960px, 94vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button onClick={requestClose}>{jobId ? 'Close' : 'Cancel'}</Button>
            <Button disabled={step === 1 || !!jobId} onClick={() => goto(step - 1)}>
              Back
            </Button>
            {step < STEPS.length && (
              <Button variant="primary" disabled={blocked} onClick={() => goto(step + 1)}>
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
                  className={`text-[13px] disabled:text-faint ${n === step ? 'font-semibold' : 'text-muted'}`}
                >
                  {n} {label}
                </button>
              </li>
            )
          })}
        </ol>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-3">
          {planError && step > 1 && step < 4 && (
            <p role="alert" className="mt-0 text-danger">
              {describeError(planError)}
            </p>
          )}
          {body}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this import?"
        message="The uploaded file and your mapping will be discarded."
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
