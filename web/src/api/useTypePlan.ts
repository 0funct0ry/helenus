import { useEffect, useState } from 'react'
import { api } from './client'
import type { TypePlan, TypeRequest } from './types'

const EMPTY: TypePlan = { statement: '', errors: [], notes: [], dependents: [] }

/**
 * Debounced live DDL preview for a UDT action. Pass `null` to skip. The plan comes from the server so
 * the preview matches exactly what will run; a failed call shows up as a plan error.
 */
export function useTypePlan(profile: string, request: TypeRequest | null, delayMs = 150): { plan: TypePlan; pending: boolean } {
  const [state, setState] = useState<{ key: string; plan: TypePlan }>({ key: '', plan: EMPTY })
  const key = request ? JSON.stringify(request) : ''
  useEffect(() => {
    if (!key) return
    let live = true
    const timer = setTimeout(() => {
      api<TypePlan>(`/p/${encodeURIComponent(profile)}/types/preview`, { body: JSON.parse(key) })
        .then((plan) => live && setState({ key, plan }))
        .catch((e: unknown) => live && setState({ key, plan: { ...EMPTY, errors: [e instanceof Error ? e.message : String(e)] } }))
    }, delayMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [profile, key, delayMs])
  if (!key) return { plan: EMPTY, pending: false }
  return { plan: state.key === key ? state.plan : EMPTY, pending: state.key !== key }
}
