import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, describeError } from './client'
import type { ApiProfile, ApplyResponse, BundleInfo, ChangesRequest, ClusterInfo, ConnectResult, PreviewStatement, QueryRequest, QueryResponse, SchemaSnapshot, SplitStatement, TestResult } from './types'
import { toKeyspaces } from './schema'
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
      void qc.invalidateQueries({ queryKey: schemaKey(name) })
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
      qc.removeQueries({ queryKey: schemaKey(name) })
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

export const schemaKey = (profile: string) => ['schema', profile] as const

/** The schema snapshot of a connected profile, converted to the explorer's model. */
export function useSchema(profile: string, enabled: boolean) {
  return useQuery({
    queryKey: schemaKey(profile),
    enabled: enabled && !!profile,
    staleTime: Infinity,
    queryFn: () => api<SchemaSnapshot>(`/p/${enc(profile)}/schema`),
    select: toKeyspaces,
  })
}

/** Re-read the cluster's metadata and replace the cached snapshot. */
export function useRefreshSchema(profile: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<SchemaSnapshot>(`/p/${enc(profile)}/schema/refresh`, { method: 'POST' }),
    onSuccess: (snap) => {
      qc.setQueryData(schemaKey(profile), snap)
      void qc.invalidateQueries({ queryKey: ['ddl', profile] })
    },
  })
}

export type DdlObject = 'keyspace' | 'table' | 'view' | 'type' | 'function' | 'aggregate' | 'index'

function ddlQuery(profile: string, keyspace: string, object: DdlObject, name: string) {
  return {
    queryKey: ['ddl', profile, keyspace, object, name] as const,
    queryFn: async () => (await api<{ ddl: string }>(`/p/${enc(profile)}/keyspaces/${enc(keyspace)}/ddl?object=${object}&name=${enc(name)}`)).ddl,
  }
}

/** DESCRIBE output for one object. Fetched on demand, so `enabled` gates it (e.g. while a sub-view is closed). */
export function useDdl(profile: string, keyspace: string, object: DdlObject, name: string, enabled = true) {
  return useQuery({ ...ddlQuery(profile, keyspace, object, name), enabled: enabled && !!profile && !!keyspace })
}

/** Returns a function that fetches an object's DDL and puts it on the clipboard. */
export function useCopyDdl(profile: string) {
  const qc = useQueryClient()
  return async (keyspace: string, object: DdlObject, name: string) => {
    const ddl = await qc.fetchQuery(ddlQuery(profile, keyspace, object, name))
    await navigator.clipboard?.writeText(ddl)
  }
}

/**
 * Returns a function that runs one CQL statement through the profile's session. `signal` aborts the
 * HTTP request (which cancels the driver call). A `schema_change` result refreshes the schema cache.
 */
export function useRunQuery(profile: string) {
  const qc = useQueryClient()
  return useCallback(
    async (body: QueryRequest, signal?: AbortSignal) => {
      const res = await api<QueryResponse>(`/p/${enc(profile)}/query`, { body, signal })
      if (res.kind === 'schema_change') {
        void qc.invalidateQueries({ queryKey: schemaKey(profile) })
        void qc.invalidateQueries({ queryKey: ['ddl', profile] })
      }
      return res
    },
    [profile, qc],
  )
}

/** Returns a function that splits editor text into statements with byte offsets. */
export function useSplit(profile: string) {
  return useCallback(async (cql: string) => (await api<{ statements: SplitStatement[] }>(`/p/${enc(profile)}/split`, { body: { cql } })).statements, [profile])
}

/**
 * Returns `preview` and `apply` for staged grid changes (SPEC §11.3). Preview compiles them to CQL
 * without running anything; apply runs them one at a time and stops at the first failure.
 */
export function useChanges(profile: string) {
  return useMemo(
    () => ({
      preview: async (body: ChangesRequest) => (await api<{ statements: PreviewStatement[] }>(`/p/${enc(profile)}/changes/preview`, { body })).statements,
      apply: (body: ChangesRequest) => api<ApplyResponse>(`/p/${enc(profile)}/changes/apply`, { body }),
    }),
    [profile],
  )
}
