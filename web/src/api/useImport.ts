import { api, ApiError } from './client'
import type { ImportDryRun, ImportFormat, ImportMapping, ImportOptions, ImportPlan, ImportUploadResult, JobInfo } from './types'

const base = (profile: string) => `/p/${encodeURIComponent(profile)}`

export interface ImportRequest {
  upload: string
  keyspace: string
  table: string
  format: ImportFormat
  /** Omit to let the server map columns automatically. */
  mapping?: ImportMapping[] | null
  options?: ImportOptions
  rows?: number
}

function body(r: ImportRequest) {
  return {
    upload: r.upload,
    table: { keyspace: r.keyspace, table: r.table },
    format: r.format,
    mapping: r.mapping ?? undefined,
    options: r.options,
    rows: r.rows,
  }
}

/** Uploads the file as multipart form data, reporting progress from 0 to 1. */
export function uploadImport(profile: string, file: File, onProgress: (fraction: number) => void): Promise<ImportUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1${base(profile)}/import/upload`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Network error'))
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string } } & Partial<ImportUploadResult> = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* keep the empty object */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as ImportUploadResult)
      else reject(new ApiError(xhr.status, data.error?.code ?? 'error', data.error?.message ?? xhr.statusText))
    }
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

export function planImport(profile: string, r: ImportRequest, signal?: AbortSignal): Promise<ImportPlan> {
  return api(`${base(profile)}/import/plan`, { body: body(r), signal })
}

export function dryRunImport(profile: string, r: ImportRequest): Promise<ImportDryRun> {
  return api(`${base(profile)}/import/dry-run`, { body: body(r) })
}

export function startImport(profile: string, r: ImportRequest): Promise<{ id: string; job: JobInfo }> {
  return api(`${base(profile)}/import/run`, { body: body(r) })
}

/** URL of the error report (CSV) of a finished import. */
export function importErrorsUrl(profile: string, jobId: string): string {
  return `/api/v1${base(profile)}/import/${encodeURIComponent(jobId)}/errors`
}
