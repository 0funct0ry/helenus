import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { JobInfo, SeedConfig, SeedPreview, SeedProfile } from './types'

const base = (profile: string) => `/p/${encodeURIComponent(profile)}`

/** Debounced live seed preview for a table; the response carries the defaults-filled config. */
export function useSeedPreview(profile: string, keyspace: string, table: string, config: SeedConfig, delayMs = 300): { preview: SeedPreview | null; pending: boolean } {
  const [state, setState] = useState<{ key: string; preview: SeedPreview | null }>({ key: '', preview: null })
  const key = JSON.stringify(config)
  const last = useRef<SeedPreview | null>(null)
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      api<SeedPreview>(`${base(profile)}/seed/preview`, { body: { table: { keyspace, table }, config: JSON.parse(key) } })
        .then((raw) => {
          // Be tolerant of null arrays so an odd response can never crash the wizard.
          const preview: SeedPreview = { ...raw, notes: raw.notes ?? [], errors: raw.errors ?? [], rows: raw.rows ?? [], columns: raw.columns ?? [] }
          last.current = preview
          if (live) setState({ key, preview })
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e)
          const prev = last.current
          if (live && prev) setState({ key, preview: { ...prev, rows: [], statement: '', errors: [{ field: '', message }] } })
        })
    }, delayMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [profile, keyspace, table, key, delayMs])
  return { preview: state.preview, pending: state.key !== key }
}

/** One-shot preview, used to reconcile a loaded profile with the current schema. */
export function previewSeed(profile: string, keyspace: string, table: string, config: SeedConfig): Promise<SeedPreview> {
  return api<SeedPreview>(`${base(profile)}/seed/preview`, { body: { table: { keyspace, table }, config } }).then((raw) => ({
    ...raw,
    notes: raw.notes ?? [],
    errors: raw.errors ?? [],
    rows: raw.rows ?? [],
    columns: raw.columns ?? [],
  }))
}

export function startSeed(profile: string, keyspace: string, table: string, config: SeedConfig): Promise<{ id: string; job: JobInfo }> {
  return api(`${base(profile)}/seed/run`, { body: { table: { keyspace, table }, config } })
}

/** Poll interval while a tab is visible; jobs only change while running. */
const POLL_MS = 500

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/** A job, polled every 500 ms while it runs and the page is visible. */
export function useJob(profile: string, id: string | null) {
  return useQuery({
    queryKey: ['job', profile, id],
    enabled: !!id,
    queryFn: () => api<JobInfo>(`${base(profile)}/jobs/${id}`),
    refetchInterval: (q) => (q.state.data?.state === 'running' && visible() ? POLL_MS : false),
  })
}

/** All jobs of this helenus process for the profile; polls while any is running. */
export function useJobs(profile: string, enabled = true) {
  return useQuery({
    queryKey: ['jobs', profile],
    enabled: enabled && !!profile,
    queryFn: () => api<{ jobs: JobInfo[] }>(`${base(profile)}/jobs`).then((r) => r.jobs),
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === 'running') && visible() ? POLL_MS : 5000),
  })
}

export function useCancelJob(profile: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<JobInfo>(`${base(profile)}/jobs/${id}`, { method: 'DELETE' }),
    onSuccess: (_j, id) => {
      void qc.invalidateQueries({ queryKey: ['job', profile, id] })
      void qc.invalidateQueries({ queryKey: ['jobs', profile] })
    },
  })
}

export function useSeedProfiles(profile: string, keyspace: string, table: string) {
  return useQuery({
    queryKey: ['seed-profiles', profile, keyspace, table],
    queryFn: () =>
      api<{ profiles: SeedProfile[] }>(`${base(profile)}/seed/profiles?keyspace=${encodeURIComponent(keyspace)}&table=${encodeURIComponent(table)}`).then((r) => r.profiles),
  })
}

export function useSaveSeedProfile(profile: string, keyspace: string, table: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; config: SeedConfig; overwrite: boolean }) =>
      api<SeedProfile>(`${base(profile)}/seed/profiles`, { body: { keyspace, table, ...v } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seed-profiles', profile, keyspace, table] }),
  })
}

export function useDeleteSeedProfile(profile: string, keyspace: string, table: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<unknown>(`${base(profile)}/seed/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seed-profiles', profile, keyspace, table] }),
  })
}
