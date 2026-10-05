import { useEffect, useState } from 'react'
import { api } from './client'
import type { AggregatePlan, AggregateRequest } from './types'

const EMPTY: AggregatePlan = { statement: '', errors: [], notes: [] }

/**
 * Debounced live CREATE / CREATE OR REPLACE / DROP AGGREGATE preview, modeled on `useFunctionPlan`. The plan comes
 * from the server so the preview matches exactly what will run; a failed call shows up as a plan error.
 */
export function useAggregatePlan(profile: string, request: AggregateRequest, enabled = true, delayMs = 250): { plan: AggregatePlan; pending: boolean } {
  const [state, setState] = useState<{ key: string; plan: AggregatePlan }>({ key: '', plan: EMPTY })
  const key = JSON.stringify(request)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const timer = setTimeout(() => {
      api<AggregatePlan>(`/p/${encodeURIComponent(profile)}/aggregates/preview`, { body: JSON.parse(key) })
        .then((plan) => live && setState({ key, plan }))
        .catch((e: unknown) => live && setState({ key, plan: { ...EMPTY, errors: [{ field: '', message: e instanceof Error ? e.message : String(e) }] } }))
    }, delayMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [profile, key, delayMs, enabled])
  return { plan: state.key === key ? state.plan : EMPTY, pending: state.key !== key }
}
