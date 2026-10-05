import { useEffect, useState } from 'react'
import { api } from './client'
import type { TableActionRequest, TablePlan, TableRequest } from './types'

const EMPTY: TablePlan = { statement: '', errors: [], notes: [] }

/**
 * Debounced live CREATE TABLE preview, modeled on `useKeyspacePlan`. The plan comes from the server so the
 * preview matches exactly what will run; a failed call shows up as a plan error with no field.
 */
export function useTablePlan(profile: string, request: TableRequest | TableActionRequest, delayMs = 250): { plan: TablePlan; pending: boolean } {
  const [state, setState] = useState<{ key: string; plan: TablePlan }>({ key: '', plan: EMPTY })
  const key = JSON.stringify(request)
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      api<TablePlan>(`/p/${encodeURIComponent(profile)}/tables/preview`, { body: JSON.parse(key) })
        .then((plan) => live && setState({ key, plan }))
        .catch((e: unknown) => live && setState({ key, plan: { ...EMPTY, errors: [{ field: '', message: e instanceof Error ? e.message : String(e) }] } }))
    }, delayMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [profile, key, delayMs])
  return { plan: state.key === key ? state.plan : EMPTY, pending: state.key !== key }
}
