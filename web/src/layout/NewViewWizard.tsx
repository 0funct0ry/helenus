import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { NewViewColumnsStep } from './NewViewColumnsStep'
import { NewViewKeysStep } from './NewViewKeysStep'
import { NewTableOptionsStep } from './NewTableOptionsStep'
import { NewTableReviewStep } from './NewTableReviewStep'
import { TypePlanPreview } from './TypePlanPreview'
import { useCluster, useSchema } from '../api/hooks'
import { useRunDdl } from '../api/useRunDdl'
import { useViewPlan } from '../api/useViewPlan'
import { useWorkspace } from '../store/workspace'
import { newViewDraft, toViewRequest } from '../lib/viewDraft'
import type { ViewDraft } from '../lib/viewDraft'

export interface NewViewWizardProps {
  keyspace: string
  /** Base table to preselect, with its key columns pre-placed. */
  baseTable?: string
  /** Called with the view name after it was created; the wizard then closes itself via `onClose`. */
  onCreated: (name: string) => void
  onClose: () => void
}

const STEPS = ['Base & columns', 'Keys', 'Options', 'Review']

/**
 * "New materialized view in <keyspace>" wizard: Base & columns, Keys, Options, Review. The server plans
 * the statement from the whole draft (debounced) and its errors carry the step they belong to; Next is
 * disabled while the current step has errors. Create runs the reviewed statement once through /query; a
 * Cassandra error (for example materialized views being disabled) shows inline on Review and keeps the
 * wizard open. Closing with edits asks for confirmation. Mount it only while open.
 */
export function NewViewWizard({ keyspace, baseTable, onCreated, onClose }: NewViewWizardProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const newQuery = useWorkspace((s) => s.newQuery)
  const { data: cluster } = useCluster(profileId, true)
  const { data: keyspaces } = useSchema(profileId, true)
  const runDdl = useRunDdl(profileId)
  const tables = useMemo(() => keyspaces?.find((k) => k.name === keyspace)?.tables.filter((t) => !t.counter) ?? [], [keyspaces, keyspace])
  const [draft, setDraft] = useState<ViewDraft>(() => newViewDraft(tables.find((t) => t.name === baseTable)))
  const [initial, setInitial] = useState(() => JSON.stringify(draft))
  // The schema may still be loading when the wizard opens; apply the preselected base once it arrives.
  useEffect(() => {
    const t = tables.find((x) => x.name === baseTable)
    if (!t || draft.baseTable) return
    const d = newViewDraft(t)
    setDraft(d)
    setInitial(JSON.stringify(d))
  }, [tables, baseTable, draft.baseTable])
  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)
  const [touched, setTouched] = useState<Record<number, boolean>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const inFlight = useRef(false)

  const serverMajor = parseInt(cluster?.release_version ?? '0', 10) || 0
  const { plan, pending } = useViewPlan(profileId, toViewRequest(keyspace, draft))
  const base = tables.find((t) => t.name === draft.baseTable)

  const stepErrors = (n: number) => plan.errors.filter((e) => e.step === n)
  const hasErrors = (n: number) => stepErrors(n).length > 0
  const visible = (n: number) => {
    const out: Record<string, string> = {}
    if (touched[n]) for (const e of stepErrors(n)) out[e.field] ??= e.message
    return out
  }
  const dirty = JSON.stringify(draft) !== initial
  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose())
  const goto = (n: number) => {
    setStep(n)
    setReached((r) => Math.max(r, n))
  }

  const create = async () => {
    if (!plan.statement || pending || inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await runDdl(plan.statement, keyspace)
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
    } else {
      onCreated(draft.name)
      onClose()
    }
  }

  const panel = { ...plan, errors: touched[step] ? stepErrors(step) : [] }
  const body = (() => {
    switch (step) {
      case 1:
        return <NewViewColumnsStep draft={draft} onChange={setDraft} tables={tables} errors={visible(1)} />
      case 2:
        return <NewViewKeysStep draft={draft} onChange={setDraft} base={base} errors={visible(2)} />
      case 3:
        return <NewTableOptionsStep draft={draft} onChange={setDraft} serverMajor={serverMajor} errors={visible(3)} />
      default:
        return (
          <NewTableReviewStep
            plan={plan}
            pending={pending}
            error={error}
            onCopy={() => void navigator.clipboard?.writeText(plan.statement)}
            onOpenInEditor={() => {
              newQuery({ keyspace, cql: plan.statement })
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
        title={`New view in ${keyspace}`}
        width="min(960px, 94vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button onClick={requestClose}>Cancel</Button>
            <Button disabled={step === 1} onClick={() => goto(step - 1)}>
              Back
            </Button>
            {step < 4 ? (
              <Button variant="primary" disabled={hasErrors(step) || pending || (step === 1 && !draft.baseTable)} onClick={() => goto(step + 1)}>
                Next
              </Button>
            ) : (
              <Button variant="primary" disabled={!plan.statement || plan.errors.length > 0 || pending || running} onClick={() => void create()}>
                Create view
              </Button>
            )}
          </>
        }
      >
        <ol aria-label="Steps" className="m-0 flex list-none gap-4 border-b border-line2 px-5 py-2">
          {STEPS.map((label, i) => {
            const n = i + 1
            const visited = n <= reached
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!visited}
                  aria-current={n === step ? 'step' : undefined}
                  onClick={() => goto(n)}
                  className={`flex items-center gap-1.5 text-[13px] disabled:text-faint ${n === step ? 'font-semibold' : 'text-muted'}`}
                >
                  {n} {label}
                  {visited && n !== step && hasErrors(n) && <span role="img" aria-label={`${label} has errors`} className="h-1.5 w-1.5 rounded-full bg-danger" />}
                </button>
              </li>
            )
          })}
        </ol>
        <div
          className="flex max-h-[70vh] gap-4 overflow-hidden px-5 py-3"
          onBlurCapture={() => setTouched((t) => (t[step] ? t : { ...t, [step]: true }))}
        >
          <div className={`min-w-0 overflow-y-auto overflow-x-hidden ${step < 4 ? 'flex-[3]' : 'flex-1'}`}>{body}</div>
          {step < 4 && (
            <div className="min-w-0 flex-[2] overflow-y-auto">
              <h3 className="mb-2 mt-0 text-[13px] font-semibold">CQL</h3>
              <TypePlanPreview plan={panel} pending={pending} />
            </div>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this view?"
        message="The details you entered will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
