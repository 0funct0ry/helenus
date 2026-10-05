import { useEffect, useState } from 'react'
import { previewRole } from './useRoles'
import type { RolePlan, RoleRequest } from './types'

const EMPTY: RolePlan = { statement: '', errors: [], notes: [] }

/**
 * Debounced live role-statement preview from `/roles/preview`. The returned statement always has the password masked,
 * and the password is never part of any query key.
 */
export function useRolePlan(profile: string, request: RoleRequest, enabled = true, delayMs = 250): { plan: RolePlan; pending: boolean } {
  const [state, setState] = useState<{ key: string; plan: RolePlan }>({ key: '', plan: EMPTY })
  const key = JSON.stringify(request)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const timer = setTimeout(() => {
      previewRole(profile, JSON.parse(key) as RoleRequest)
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
