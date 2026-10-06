/** An error response in the SPEC §11 shape, or a network failure. */
/** Called when a request other than sign-in answers 401, so the app can return to the sign-in screen. */
let unauthorizedHandler: (() => void) | undefined

export function onUnauthorized(handler: (() => void) | undefined) {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail?: { failed_stage?: string; [key: string]: unknown }

  constructor(status: number, code: string, message: string, detail?: ApiError['detail']) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** Describe a failure for display, naming the connection stage when the API reported one. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError && e.detail?.failed_stage) return `Failed at the ${e.detail.failed_stage} stage: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

/** Call `/api/v1{path}` with JSON in and out. 204 resolves to undefined. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET')
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: headersFor(method, init),
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError(499, 'cancelled', 'Cancelled')
    throw new ApiError(0, 'network_error', e instanceof Error ? e.message : 'Network error')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') unauthorizedHandler?.()
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText, err?.detail)
  }
  return data as T
}

/** JSON requests that change state carry Content-Type: application/json; uploads carry X-Helenus-Request (SPEC §12.2). */
function headersFor(method: string, init: { body?: unknown; form?: FormData }): Record<string, string> | undefined {
  if (init.form) return { 'X-Helenus-Request': '1' }
  if (init.body !== undefined || (method !== 'GET' && method !== 'HEAD')) return { 'Content-Type': 'application/json' }
  return undefined
}
