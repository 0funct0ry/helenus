import { useEffect, useState } from 'react'
import { api } from './client'
import type { KeyspacePlan, KeyspaceRequest } from './types'

const EMPTY: KeyspacePlan = { statement: '', errors: [], notes: [] }

/**
 * Debounced live CREATE KEYSPACE preview. The plan comes from the server so the preview matches exactly
 * what will run; a failed call shows up as a plan error with no field.
 */
export function useKeyspacePlan(profile: string, request: KeyspaceRequest, delayMs = 250): { plan: KeyspacePlan; pending: boolean } {
  const [state, setState] = useState<{ key: string; plan: KeyspacePlan }>({ key: '', plan: EMPTY })
  const key = JSON.stringify(request)
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      api<KeyspacePlan>(`/p/${encodeURIComponent(profile)}/keyspaces/preview`, { body: JSON.parse(key) })
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
