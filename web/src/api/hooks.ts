import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, describeError } from './client'
import type { ApiProfile, BundleInfo, ClusterInfo, ConnectResult, TestResult } from './types'
import { useWorkspace } from '../store/workspace'

const enc = encodeURIComponent
export const profilesKey = ['profiles'] as const

/** The profile list, secrets redacted. */
export function useProfiles() {
  return useQuery({ queryKey: profilesKey, queryFn: async () => (await api<{ profiles: ApiProfile[] }>('/profiles')).profiles })
}

/** Cluster summary for a connected profile (status bar). */
export function useCluster(name: string, enabled: boolean) {
  return useQuery({ queryKey: ['cluster', name], enabled: enabled && !!name, queryFn: () => api<ClusterInfo>(`/p/${enc(name)}/cluster`) })
}

/** Connect a profile, tracking connecting / connected / error in the workspace store. */
export function useConnect() {
  const qc = useQueryClient()
  const setConnection = useWorkspace((s) => s.setConnection)
  return useMutation({
    mutationFn: (name: string) => api<ConnectResult>(`/p/${enc(name)}/connect`, { method: 'POST' }),
    onMutate: (name) => setConnection(name, 'connecting'),
    onSuccess: (res, name) => {
      setConnection(name, 'connected')
      qc.setQueryData(['cluster', name], res.cluster)
      void qc.invalidateQueries({ queryKey: profilesKey })
    },
    onError: (e, name) => setConnection(name, 'error', describeError(e)),
  })
}

/** Close a profile's session. */
export function useDisconnect() {
  const qc = useQueryClient()
  const clear = useWorkspace((s) => s.clearConnection)
  return useMutation({
    mutationFn: (name: string) => api<void>(`/p/${enc(name)}/connect`, { method: 'DELETE' }),
    onSuccess: (_r, name) => {
      clear(name)
      void qc.invalidateQueries({ queryKey: profilesKey })
    },
  })
}

/** Create (no `original`) or update a profile. */
export function useSaveProfile() {
  const qc = useQueryClient()
  const clear = useWorkspace((s) => s.clearConnection)
  return useMutation({
    mutationFn: ({ original, body }: { original: string; body: Record<string, unknown> }) =>
      original ? api<ApiProfile>(`/profiles/${enc(original)}`, { method: 'PUT', body }) : api<ApiProfile>('/profiles', { method: 'POST', body }),
    onSuccess: (_p, { original }) => {
      if (original) clear(original)
      void qc.invalidateQueries({ queryKey: profilesKey })
    },
  })
}

/** Delete a profile. */
export function useDeleteProfile() {
  const qc = useQueryClient()
  const clear = useWorkspace((s) => s.clearConnection)
  return useMutation({
    mutationFn: (name: string) => api<void>(`/profiles/${enc(name)}`, { method: 'DELETE' }),
    onSuccess: (_r, name) => {
      clear(name)
      void qc.invalidateQueries({ queryKey: profilesKey })
    },
  })
}

/** Test a (possibly unsaved) profile body without saving it. */
export function useTestProfile() {
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api<TestResult>('/profiles/test', { method: 'POST', body }) })
}

/** Upload an Astra secure connect bundle; resolves to its stored path. */
export function useUploadBundle() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('bundle', file)
      return api<BundleInfo>('/profiles/astra/bundle', { form })
    },
  })
}
