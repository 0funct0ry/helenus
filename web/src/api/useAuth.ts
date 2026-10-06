import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onUnauthorized } from './client'
import { useSession } from '../store/session'
import { useWorkspace } from '../store/workspace'

export interface Meta {
  version: string
  auth_enabled: boolean
  user?: string
  tls?: boolean
  /** The server is reachable from the network over plain HTTP. */
  insecure_bind?: boolean
}

export const metaKey = ['meta'] as const

/** Server metadata: version, whether sign-in is on, the signed-in user and bind warnings. */
export function useMeta() {
  return useQuery({ queryKey: metaKey, queryFn: () => api<Meta>('/meta'), staleTime: 60_000 })
}

/** Whether the app must show the sign-in screen, plus the signed-in username. */
export function useAuthGate() {
  const { data: meta } = useMeta()
  const sessionUser = useSession((s) => s.user)
  const expired = useSession((s) => s.expired)
  const user = sessionUser ?? meta?.user ?? null
  const authEnabled = !!meta?.auth_enabled
  useEffect(() => {
    onUnauthorized(() => useSession.getState().expire())
    return () => onUnauthorized(undefined)
  }, [])
  return { authEnabled, user, needsSignIn: authEnabled && (!user || expired), meta }
}

/** Sign in; on success every query is refetched and the workspace stays as it was. */
export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { username: string; password: string }) => api<{ username: string }>('/auth/login', { body: v }),
    onSuccess: (r) => {
      useSession.getState().signIn(r.username)
      void qc.invalidateQueries()
    },
  })
}

/** Sign out, revoking the session on the server and clearing everything held for the user. */
export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      useWorkspace.setState({ tabs: [], activeId: '', queryStates: {}, edits: {}, editErrors: {} })
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== metaKey[0] })
      useSession.getState().signOut()
    },
  })
}
