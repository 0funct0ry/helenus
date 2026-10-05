import { useEffect, useState } from 'react'
import { api } from './client'
import type { TriggerPlan, TriggerRequest } from './types'

const EMPTY: TriggerPlan = { statement: '', errors: [], notes: [] }

/**
 * Debounced live CREATE/DROP TRIGGER preview, modeled on `useTablePlan`. The plan comes from the server so the
 * preview matches exactly what will run; a failed call shows up as a plan error with no field.
 */
export function useTriggerPlan(profile: string, request: TriggerRequest, enabled = true, delayMs = 250): { plan: TriggerPlan; pending: boolean } {
  const [state, setState] = useState<{ key: string; plan: TriggerPlan }>({ key: '', plan: EMPTY })
  const key = JSON.stringify(request)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const timer = setTimeout(() => {
      api<TriggerPlan>(`/p/${encodeURIComponent(profile)}/triggers/preview`, { body: JSON.parse(key) })
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
