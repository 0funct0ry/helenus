import { api } from './client'
import type { CompleteRequest, CompleteResponse } from './types'

/** Ask the server for completions at the cursor. `signal` aborts the request when typing moves on. */
export function fetchCompletions(profile: string, body: CompleteRequest, signal?: AbortSignal): Promise<CompleteResponse> {
  return api<CompleteResponse>(`/p/${encodeURIComponent(profile)}/complete`, { body, signal })
}
