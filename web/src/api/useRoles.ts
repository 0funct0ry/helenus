import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { schemaChangesKey } from './hooks'
import type { RolePermission, RoleRequest, RolesResponse } from './types'

const enc = encodeURIComponent
export const rolesKey = (profile: string) => ['roles', profile] as const

/** Roles, membership and auth state for the connected profile. */
export function useRoles(profile: string, enabled: boolean) {
  return useQuery({ queryKey: rolesKey(profile), enabled: enabled && !!profile, queryFn: () => api<RolesResponse>(`/p/${enc(profile)}/roles`) })
}

/** Permissions granted directly to a role. */
export function useRolePermissions(profile: string, role: string, enabled = true) {
  return useQuery({
    queryKey: [...rolesKey(profile), 'permissions', role],
    enabled: enabled && !!role,
    queryFn: () => api<{ authorizer_enabled: boolean; permissions: RolePermission[] }>(`/p/${enc(profile)}/roles/${enc(role)}/permissions`),
  })
}

/** Preview the masked statement for one request. */
export function previewRole(profile: string, request: RoleRequest) {
  return api<{ statement: string; errors: { field: string; message: string }[]; notes: string[] }>(`/p/${enc(profile)}/roles/preview`, { body: request })
}

/**
 * Returns a function that applies one role request through `/roles/apply` (never `/query`, so passwords stay out of
 * query paths). It resolves to an error message, or `null` on success, and refreshes the role data.
 */
export function useApplyRole(profile: string) {
  const qc = useQueryClient()
  const m = useMutation({ mutationFn: (request: RoleRequest) => api<{ ok: boolean; statement: string }>(`/p/${enc(profile)}/roles/apply`, { body: request }) })
  return async (request: RoleRequest): Promise<string | null> => {
    try {
      await m.mutateAsync(request)
      void qc.invalidateQueries({ queryKey: rolesKey(profile) })
      void qc.invalidateQueries({ queryKey: schemaChangesKey(profile) })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
}
