import { useCallback, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TypeBadge } from '../ui/TypeBadge'
import { ScalarInput } from './ScalarInput'
import { invokeFunction } from '../api/invokeFunction'
import { describeError } from '../api/client'
import { InputValidity } from '../lib/inputValidity'
import { NATIVE_TYPES } from '../lib/typeBuilder'
import { useWorkspace } from '../store/workspace'
import type { InvokeResult } from '../api/types'
import type { Fn } from '../lib/schemaModel'

export interface FunctionTestPanelProps {
  fn: Fn
}

const isScalar = (cql: string) => NATIVE_TYPES.includes(cql)

/**
 * Test panel of the Function tab: one input per argument and a Run button that calls the function through
 * the server (`SELECT ks.f(...) FROM system.local`). Scalar arguments use the typed ScalarInput from the grid
 * editors; collection, tuple and UDT arguments take JSON text (an array for list, set and tuple, an object
 * for map and UDT). Shows the returned value with the elapsed time, or the server's error.
 */
export function FunctionTestPanel({ fn }: FunctionTestPanelProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const [values, setValues] = useState<unknown[]>(() => fn.argTypes.map(() => null))
  const [json, setJson] = useState<string[]>(() => fn.argTypes.map(() => ''))
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<InvokeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const report = useCallback((id: string, err: string | null) => {
    setInvalid((cur) => {
      if (err === null) {
        if (!(id in cur)) return cur
        const next = { ...cur }
        delete next[id]
        return next
      }
      return cur[id] === err ? cur : { ...cur, [id]: err }
    })
  }, [])

  const parsed = fn.argTypes.map((t, i) => {
    if (isScalar(t)) return { ok: true as const, value: values[i] }
    if (json[i].trim() === '') return { ok: true as const, value: null }
    try {
      return { ok: true as const, value: JSON.parse(json[i]) as unknown }
    } catch {
      return { ok: false as const }
    }
  })
  const valid = parsed.every((p) => p.ok) && Object.keys(invalid).length === 0

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await invokeFunction(profileId, fn.keyspace, fn.name, fn.signature, parsed.map((p) => (p.ok ? p.value : null))))
    } catch (e) {
      setResult(null)
      setError(describeError(e))
    }
    setRunning(false)
  }

  return (
    <section aria-label="Test function">
      <InputValidity.Provider value={report}>
        <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          {fn.argTypes.map((t, i) => (
            <li key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: '110px 1fr' }}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-mono text-[12.5px]">{fn.argNames[i] ?? `arg ${i + 1}`}</span>
                <TypeBadge type={t} />
              </span>
              {isScalar(t) ? (
                <ScalarInput type={{ name: t }} value={values[i]} aria-label={`Argument ${fn.argNames[i] ?? i + 1}`} optional onChange={(v) => setValues((vs) => vs.map((x, n) => (n === i ? v : x)))} />
              ) : (
                <Input
                  mono
                  aria-label={`Argument ${fn.argNames[i] ?? i + 1} (JSON)`}
                  placeholder="JSON value"
                  value={json[i]}
                  aria-invalid={!parsed[i].ok}
                  onChange={(e) => setJson((js) => js.map((x, n) => (n === i ? e.target.value : x)))}
                />
              )}
            </li>
          ))}
        </ul>
      </InputValidity.Provider>
      <Button variant="primary" icon={<Play size={14} />} disabled={!valid || running} onClick={() => void run()}>
        Run
      </Button>
      {result && (
        <p aria-label="Function result" className="mb-0 mt-3 font-mono text-[12.5px]">
          <span className="text-muted">result = </span>
          {result.value === null || result.value === undefined ? 'null' : typeof result.value === 'object' ? JSON.stringify(result.value) : String(result.value)}
          <span className="ml-2 text-muted">{result.elapsed_ms.toFixed(1)} ms</span>
        </p>
      )}
      {error && (
        <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
