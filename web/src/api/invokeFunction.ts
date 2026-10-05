import { api } from './client'
import type { InvokeResult } from './types'

/** Call a UDF with literal arguments (`POST /p/{profile}/functions/invoke`); `args` are JSON values in argument order. */
export function invokeFunction(profile: string, keyspace: string, name: string, signature: string, args: unknown[]): Promise<InvokeResult> {
  return api<InvokeResult>(`/p/${encodeURIComponent(profile)}/functions/invoke`, { body: { keyspace, name, signature, args } })
}
