import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TypeBadge } from '../ui/TypeBadge'
import { CodeEditor } from './CodeEditor'
import { TypePicker } from './TypePicker'
import { TypePlanPreview } from './TypePlanPreview'
import { useFunctionPlan } from '../api/useFunctionPlan'
import { useRunDdl } from '../api/useRunDdl'
import { useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import { cqlToDraft, draftToCql, newDraft } from '../lib/typeBuilder'
import type { TypeDraft } from '../lib/typeBuilder'
import type { Fn } from '../lib/schemaModel'

export interface FunctionEditorProps {
  keyspace: string
  /** The function being edited. When set the editor is in replace mode: the name and argument types are locked. */
  existing?: Fn
  /** Major version of the connected server; JavaScript functions need 4.x. */
  serverMajor: number
  /** Called with the new function's signature after it was saved. */
  onSaved: (signature: string) => void
  onClose: () => void
}

interface ArgDraft {
  id: number
  name: string
  type: TypeDraft
}

let nextId = 1
const blankArg = (): ArgDraft => ({ id: nextId++, name: '', type: newDraft('text') })
const BODY_HINT = '// Java: the arguments are variables; return the result.\nreturn null;'

/**
 * Create or replace a user-defined function: name, arguments (name plus type picker), return type, null
 * behaviour, language, a Java body in CodeMirror and a live CREATE [OR REPLACE] FUNCTION preview built by
 * the server. In replace mode (opened from "Edit" on a function) the name and argument types are locked and
 * the preview is CREATE OR REPLACE. JavaScript is offered only before Cassandra 5.0. Mount it only while open.
 */
export function FunctionEditor({ keyspace, existing, serverMajor, onSaved, onClose }: FunctionEditorProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const { data: keyspaces } = useSchema(profileId, true)
  const udts = keyspaces?.find((k) => k.name === keyspace)?.types.map((t) => t.name) ?? []
  const runDdl = useRunDdl(profileId)
  const replace = !!existing
  const [name, setName] = useState(existing?.name ?? '')
  const [args, setArgs] = useState<ArgDraft[]>(() => (existing ? [] : [blankArg()]))
  const [returns, setReturns] = useState<TypeDraft>(() => (existing ? cqlToDraft(existing.returnType) : newDraft('int')))
  const [calledOnNull, setCalledOnNull] = useState(existing?.calledOnNull ?? false)
  const [language, setLanguage] = useState<'java' | 'javascript'>(existing?.language === 'javascript' ? 'javascript' : 'java')
  const [body, setBody] = useState(existing?.body ?? BODY_HINT)
  const [ifNotExists, setIfNotExists] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const request = useMemo(
    () => ({
      action: replace ? ('replace' as const) : ('create' as const),
      keyspace,
      name,
      args: existing ? existing.argTypes.map((type, i) => ({ name: existing.argNames[i] ?? `a${i}`, type })) : args.map((a) => ({ name: a.name, type: draftToCql(a.type) })),
      returns: draftToCql(returns),
      called_on_null: calledOnNull,
      language,
      body,
      if_not_exists: !replace && ifNotExists,
    }),
    [replace, keyspace, name, existing, args, returns, calledOnNull, language, body, ifNotExists],
  )
  const { plan, pending } = useFunctionPlan(profileId, request)
  const setArg = (id: number, patch: Partial<ArgDraft>) => setArgs((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)))

  const save = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await runDdl(plan.statement, keyspace)
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
    } else {
      onSaved(existing ? existing.signature : `${name}(${args.map((a) => draftToCql(a.type)).join(', ')})`)
      onClose()
    }
  }

  const languages = [{ value: 'java' as const, label: 'Java' }, ...(serverMajor < 5 ? [{ value: 'javascript' as const, label: 'JavaScript' }] : [])]
  const label = 'text-xs text-muted'
  return (
    <Dialog
      open
      onClose={onClose}
      title={replace ? 'Edit function' : 'New function'}
      subtitle={replace ? `${keyspace}.${existing.signature}` : keyspace}
      width="min(920px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!plan.statement || pending || running} onClick={() => void save()}>
            {replace ? 'Replace function' : 'Create function'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-3">
        <Field label="Function name" mono value={name} disabled={replace} placeholder="add_tax" autoFocus={!replace} onChange={(e) => setName(e.target.value)} />
        <h3 className="mb-2 mt-1 text-[13px] font-semibold">Arguments</h3>
        {existing ? (
          <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0">
            {existing.argTypes.map((t, i) => (
              <li key={i} className="flex items-center gap-2 font-mono text-[12.5px]">
                {existing.argNames[i]} <TypeBadge type={t} />
              </li>
            ))}
            {existing.argTypes.length === 0 && <li className="text-muted">No arguments</li>}
            <li className="text-xs text-muted">Argument names and types are locked when replacing a function.</li>
          </ul>
        ) : (
          <>
            <ul className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
              {args.map((a, i) => (
                <li key={a.id} className="flex items-start gap-2">
                  <div className="w-48 shrink-0">
                    <Input mono aria-label={`Argument ${i + 1} name`} placeholder="name" value={a.name} onChange={(e) => setArg(a.id, { name: e.target.value })} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <TypePicker value={a.type} onChange={(type) => setArg(a.id, { type })} udts={udts} label={`Argument ${i + 1} type`} />
                  </div>
                  <IconButton label={`Remove argument ${i + 1}`} icon={<X size={13} />} onClick={() => setArgs((as) => as.filter((x) => x.id !== a.id))} />
                </li>
              ))}
            </ul>
            <Button icon={<Plus size={14} />} onClick={() => setArgs((as) => [...as, blankArg()])}>
              Add argument
            </Button>
          </>
        )}
        <h3 className="mb-2 mt-4 text-[13px] font-semibold">Returns</h3>
        <TypePicker value={returns} onChange={setReturns} udts={udts} label="Return type" />
        <div className="mt-4 flex flex-wrap gap-6">
          <div className="flex flex-col gap-[5px]">
            <span className={label}>Null input</span>
            <SegmentedControl<'returns' | 'called'>
              label="Null behavior"
              value={calledOnNull ? 'called' : 'returns'}
              onChange={(v) => setCalledOnNull(v === 'called')}
              options={[
                { value: 'returns', label: 'Returns null on null input' },
                { value: 'called', label: 'Called on null input' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <span className={label}>Language</span>
            <SegmentedControl<'java' | 'javascript'> label="Language" value={language} onChange={setLanguage} options={languages} />
          </div>
          {!replace && (
            <label className="flex items-end gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={ifNotExists} onChange={(e) => setIfNotExists(e.target.checked)} /> IF NOT EXISTS
            </label>
          )}
        </div>
        <h3 className="mb-2 mt-4 text-[13px] font-semibold">Body</h3>
        <CodeEditor value={body} onChange={setBody} aria-label="Function body" />
        <div className="mt-3">
          <TypePlanPreview plan={plan} pending={pending} />
        </div>
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
