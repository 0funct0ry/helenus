import { api } from './client'
import type { RowsAggregateRequest, RowsAggregateResponse, RowsFormatRequest } from './types'

const enc = encodeURIComponent

/** Render rows in a Copy As format on the server (SPEC §9.5.1). */
export async function formatRows(profile: string, body: RowsFormatRequest): Promise<string> {
  return (await api<{ text: string }>(`/p/${enc(profile)}/rows/format`, { body })).text
}

/** Compute ROWS, COLS, COUNT, SUM, AVG … for rows on the server. */
export function aggregateRows(profile: string, body: RowsAggregateRequest): Promise<RowsAggregateResponse> {
  return api<RowsAggregateResponse>(`/p/${enc(profile)}/rows/aggregate`, { body })
}
