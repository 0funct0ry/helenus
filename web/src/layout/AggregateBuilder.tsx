import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { TypeBadge } from '../ui/TypeBadge'
import { AggregateFunctionSelect } from './AggregateFunctionSelect'
import { FunctionEditor } from './FunctionEditor'
import { ScalarInput } from './ScalarInput'
import { TypePicker } from './TypePicker'
import { TypePlanPreview } from './TypePlanPreview'
import { useAggregateCandidates } from '../api/useAggregateCandidates'
import { useAggregatePlan } from '../api/useAggregatePlan'
import { useRunDdl } from '../api/useRunDdl'
import { useCluster, useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import { InputValidity } from '../lib/inputValidity'
import { initCondToJson } from '../lib/aggregateDraft'
import { NATIVE_TYPES, cqlToDraft, draftToCql, newDraft } from '../lib/typeBuilder'
import type { TypeDraft } from '../lib/typeBuilder'
import type { Agg } from '../lib/schemaModel'

export interface AggregateBuilderProps {
  keyspace: string
  /** The aggregate being edited. When set the builder is in replace mode: the name and argument types are locked. */
  existing?: Agg
  /** Called with the new aggregate's signature after it was saved. */
  onSaved: (signature: string) => void
  onClose: () => void
}

interface ArgDraft {
  id: number
  type: TypeDraft
}

let nextId = 1
const blankArg = (): ArgDraft => ({ id: nextId++, type: newDraft('int') })
const nameOf = (signature: string) => signature.slice(0, signature.indexOf('('))

/**
 * Create or replace a user-defined aggregate: name, argument types, state type, then the SFUNC and FINALFUNC chosen
 * from the keyspace's functions (only those with a matching signature are selectable, the rest say what they need),
 * an INITCOND typed by the state type, and a live CREATE [OR REPLACE] AGGREGATE preview built by the server. "Create
 * function…" opens the function editor prefilled with the signature the slot needs and selects the new function
 * once it is saved. In replace mode (opened from "Edit" on an aggregate) the name and argument types are locked.
 * Mount it only while open.
 */
export function AggregateBuilder({ keyspace, existing, onSaved, onClose }: AggregateBuilderProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces } = useSchema(profileId, true)
  const { data: cluster } = useCluster(profileId, connected)
  const ks = keyspaces?.find((k) => k.name === keyspace)
  const udts = ks?.types.map((t) => t.name) ?? []
  const runDdl = useRunDdl(profileId)
  const replace = !!existing
  const [name, setName] = useState(existing?.name ?? '')
  const [args, setArgs] = useState<ArgDraft[]>(() => (existing ? [] : [blankArg()]))
  const [stype, setStype] = useState<TypeDraft>(() => (existing ? cqlToDraft(existing.stateType) : newDraft('int')))
  const [sfunc, setSfunc] = useState('')
  const [finalfunc, setFinalfunc] = useState('')
  const [initcond, setInitcond] = useState<unknown>(() => (existing ? initCondToJson(existing.initCond) : undefined))
  const [initText, setInitText] = useState(() => (existing && initCondToJson(existing.initCond) !== undefined ? JSON.stringify(initCondToJson(existing.initCond)) : ''))
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [ifNotExists, setIfNotExists] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [creating, setCreating] = useState<'sfunc' | 'finalfunc' | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const argTypes = existing ? existing.argTypes : args.map((a) => draftToCql(a.type))
  const stypeCql = draftToCql(stype)
  const scalar = NATIVE_TYPES.includes(stypeCql)
  const initJson = scalar ? initcond : initText.trim() === '' ? undefined : (() => { try { return JSON.parse(initText) as unknown } catch { return undefined } })()
  const initBroken = !scalar && initText.trim() !== '' && initJson === undefined

  // Pick the existing aggregate's functions once their candidate lists load.
  const sfuncCands = useAggregateCandidates(profileId, keyspace, argTypes, stypeCql, false, nonce)
  const finalCands = useAggregateCandidates(profileId, keyspace, argTypes, stypeCql, true, nonce)
  const [seeded, setSeeded] = useState(false)
  if (existing && !seeded && sfuncCands.length > 0) {
    setSeeded(true)
    setSfunc(sfuncCands.find((c) => c.name === existing.stateFunc && c.ok)?.signature ?? '')
    setFinalfunc(finalCands.find((c) => c.name === existing.finalFunc && c.ok)?.signature ?? '')
  }

  const request = useMemo(
    () => ({
      action: replace ? ('replace' as const) : ('create' as const),
      keyspace,
      name,
      arg_types: argTypes,
      sfunc: sfunc ? nameOf(sfunc) : '',
      stype: stypeCql,
      finalfunc: finalfunc ? nameOf(finalfunc) : '',
      ...(initJson !== undefined && initJson !== null ? { initcond: initJson } : {}),
      if_not_exists: !replace && ifNotExists,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replace, keyspace, name, JSON.stringify(argTypes), sfunc, stypeCql, finalfunc, JSON.stringify(initJson ?? null), ifNotExists],
  )
  const { plan, pending } = useAggregatePlan(profileId, request)
  const initError = plan.errors.find((e) => typeof e !== 'string' && e.field === 'initcond')
  const setArg = (id: number, type: TypeDraft) => setArgs((as) => as.map((a) => (a.id === id ? { ...a, type } : a)))
  const report = (id: string, err: string | null) =>
    setInvalid((cur) => {
      if (err === null) {
        if (!(id in cur)) return cur
        const next = { ...cur }
        delete next[id]
        return next
      }
      return cur[id] === err ? cur : { ...cur, [id]: err }
    })

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
      onSaved(existing ? existing.signature : `${name}(${argTypes.join(', ')})`)
      onClose()
    }
  }

  const stateName = 'state'
  const initialFor = (slot: 'sfunc' | 'finalfunc') =>
    slot === 'sfunc'
      ? { args: [{ name: stateName, type: stypeCql }, ...argTypes.map((t, i) => ({ name: `val${i + 1}`, type: t }))], returns: stypeCql }
      : { args: [{ name: stateName, type: stypeCql }], returns: 'double' }

  return (
    <Dialog
      open
      onClose={onClose}
      title={replace ? 'Edit aggregate' : 'New aggregate'}
      subtitle={replace ? `${keyspace}.${existing.signature}` : keyspace}
      width="min(920px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!plan.statement || pending || running || initBroken || Object.keys(invalid).length > 0} onClick={() => void save()}>
            {replace ? 'Replace aggregate' : 'Create aggregate'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-3">
        <Field label="Aggregate name" mono value={name} disabled={replace} placeholder="average" autoFocus={!replace} onChange={(e) => setName(e.target.value)} />
        <h3 className="mb-2 mt-1 text-[13px] font-semibold">Argument types</h3>
        {existing ? (
          <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0">
            {existing.argTypes.map((t, i) => (
              <li key={i} className="flex items-center gap-2 font-mono text-[12.5px]">
                <TypeBadge type={t} />
              </li>
            ))}
            <li className="text-xs text-muted">Argument types are locked when replacing an aggregate.</li>
          </ul>
        ) : (
          <>
            <ul className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
              {args.map((a, i) => (
                <li key={a.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <TypePicker value={a.type} onChange={(t) => setArg(a.id, t)} udts={udts} label={`Argument ${i + 1} type`} />
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
        <h3 className="mb-2 mt-4 text-[13px] font-semibold">State type</h3>
        <TypePicker value={stype} onChange={setStype} udts={udts} label="State type" />
        <div className="mt-4 flex flex-col gap-4">
          <AggregateFunctionSelect label="State function" value={sfunc} candidates={sfuncCands} onChange={setSfunc} onCreate={() => setCreating('sfunc')} />
          <AggregateFunctionSelect label="Final function" optional value={finalfunc} candidates={finalCands} onChange={setFinalfunc} onCreate={() => setCreating('finalfunc')} />
          <div className="flex flex-col gap-[5px]">
            <span className="text-xs text-muted">Initial condition ({stypeCql})</span>
            {scalar ? (
              <InputValidity.Provider value={report}>
                <ScalarInput type={{ name: stypeCql }} value={initcond ?? null} optional aria-label="Initial condition" onChange={(v) => setInitcond(v)} />
              </InputValidity.Provider>
            ) : (
              <Input mono aria-label="Initial condition" placeholder={stypeCql.startsWith('tuple') ? '[0, 0]' : 'JSON value'} value={initText} aria-invalid={initBroken || !!initError} onChange={(e) => setInitText(e.target.value)} />
            )}
            {initBroken && <span role="alert" className="text-xs text-danger">INITCOND is not valid JSON</span>}
            {initError && <span role="alert" className="text-xs text-danger">{initError.message}</span>}
            <span className="text-xs text-muted">Leave empty for no INITCOND; the state then starts as null.</span>
          </div>
          {!replace && (
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={ifNotExists} onChange={(e) => setIfNotExists(e.target.checked)} /> IF NOT EXISTS
            </label>
          )}
        </div>
        <div className="mt-3">
          <TypePlanPreview plan={plan} pending={pending} />
        </div>
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
      {creating && (
        <FunctionEditor
          keyspace={keyspace}
          initial={initialFor(creating)}
          serverMajor={parseInt(cluster?.release_version ?? '0', 10) || 0}
          onSaved={(signature) => {
            setNonce((n) => n + 1)
            if (creating === 'sfunc') setSfunc(signature)
            else setFinalfunc(signature)
          }}
          onClose={() => setCreating(null)}
        />
      )}
    </Dialog>
  )
}
