import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { ExportFormat, ExportOptions, ExportPreset, ExportSource, JobInfo } from './types'

const base = (profile: string) => `/p/${encodeURIComponent(profile)}`

export interface ExportRequest {
  source: ExportSource
  format: ExportFormat
  options: Partial<ExportOptions>
  /** Checked columns of a table export; omit for all. */
  columns?: string[]
  filename: string
  /** Token-range split for whole tables (1–64). */
  ranges?: number
}

/** Starts an export job; resolves to its id. */
export function startExport(profile: string, r: ExportRequest): Promise<{ id: string; job: JobInfo; filename: string }> {
  const source = r.source.kind === 'table' ? { table: { keyspace: r.source.keyspace, table: r.source.table, columns: r.columns } } : { query: r.source.cql }
  return api(`${base(profile)}/export`, {
    body: { source, format: r.format, options: r.options, filename: r.filename, ranges: r.ranges && r.ranges > 1 ? r.ranges : undefined, concurrency: r.ranges },
  })
}

/** URL of a finished export's file; the server deletes the file after one download. */
export function exportFileUrl(profile: string, jobId: string): string {
  return `/api/v1${base(profile)}/export/${encodeURIComponent(jobId)}/file`
}

export function useExportPresets(profile: string) {
  return useQuery({
    queryKey: ['export-presets', profile],
    queryFn: () => api<{ presets: ExportPreset[] }>(`${base(profile)}/export/presets`).then((r) => r.presets),
  })
}

export interface PresetBody {
  name: string
  format: ExportFormat
  options: Partial<ExportOptions>
  columns: string[] | null
  global?: boolean
}

export function useSaveExportPreset(profile: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: PresetBody) => api<ExportPreset>(`${base(profile)}/export/presets`, { body: b }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['export-presets', profile] }),
  })
}

export function useUpdateExportPreset(profile: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; body: PresetBody }) => api<ExportPreset>(`${base(profile)}/export/presets/${v.id}`, { method: 'PUT', body: v.body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['export-presets', profile] }),
  })
}

export function useDeleteExportPreset(profile: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<unknown>(`${base(profile)}/export/presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['export-presets', profile] }),
  })
}
