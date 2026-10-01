import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type { ApiProfile } from '../api/types'

/** Render with a fresh QueryClient that never retries. */
export function renderWithClient(ui: ReactElement): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

export interface Call {
  method: string
  path: string
  body?: unknown
}

type Handler = (call: Call) => { status?: number; body?: unknown } | undefined

/**
 * Replace fetch with a router: `handlers` maps "METHOD /path" (path without /api/v1) to a response.
 * Unmatched requests answer 404. Returns the list of calls made.
 */
export function mockApi(handlers: Record<string, Handler | unknown>): Call[] {
  const calls: Call[] = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api\/v1/, '')
    const method = init?.method ?? 'GET'
    let body: unknown
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    else if (init?.body) body = init.body
    const call = { method, path, body }
    calls.push(call)
    const h = handlers[`${method} ${path}`]
    if (h === undefined) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no mock' } }), { status: 404 })
    const isSpec = typeof h === 'object' && h !== null && ('status' in h || 'body' in h)
    const out = typeof h === 'function' ? (h as Handler)(call) : isSpec ? (h as { status?: number; body?: unknown }) : { body: h }
    const status = out?.status ?? 200
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(out?.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return calls
}

/** A saved profile as the API returns it. */
export function apiProfile(over: Partial<ApiProfile> = {}): ApiProfile {
  return {
    name: 'local', hosts: ['127.0.0.1'], port: 9042, tls: { enabled: false, insecure_skip_verify: false }, astra: {},
    password_set: false, password_command_set: false, token_set: false, token_command_set: false, connected: false, ...over,
  }
}

export const cluster = {
  name: 'payments-eu', release_version: '5.0.2', cql_version: '3.4.7', protocol_version: '5', local_dc: 'eu-west-1',
  datacenters: ['eu-west-1', 'us-east-1'], nodes: [], node_count: 6,
}
