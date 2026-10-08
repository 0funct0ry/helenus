import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

const base = (profile: string) => `/p/${encodeURIComponent(profile)}/queries`

/** A saved query as the API returns it; `text` is present on get, create, update and duplicate, not on lists. */
export interface SavedQuery {
  id: number
  name: string
  text?: string
  global: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface QueryBody {
  name: string
  text: string
  global: boolean
}

export interface QueryUpdateBody extends QueryBody {
  /** The version the caller last saw; a mismatch answers 409 query_conflict. */
  version: number
}

export const queriesKey = (profile: string) => ['queries', profile] as const

/** Lists the profile's saved queries plus global ones (no text), optionally filtered by `q`. */
export function useQueries(profile: string, q = '') {
  return useQuery({
    queryKey: [...queriesKey(profile), q],
    enabled: !!profile,
    queryFn: () => api<{ queries: SavedQuery[] }>(`${base(profile)}${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.queries),
  })
}

export const getSavedQuery = (profile: string, id: number) => api<SavedQuery>(`${base(profile)}/${id}`)
export const createSavedQuery = (profile: string, b: QueryBody) => api<SavedQuery>(base(profile), { body: b })
export const updateSavedQuery = (profile: string, id: number, b: QueryUpdateBody) => api<SavedQuery>(`${base(profile)}/${id}`, { method: 'PUT', body: b })
export const deleteSavedQuery = (profile: string, id: number) => api<unknown>(`${base(profile)}/${id}`, { method: 'DELETE' })
export const duplicateSavedQuery = (profile: string, id: number) => api<SavedQuery>(`${base(profile)}/${id}/duplicate`, { method: 'POST', body: {} })

/** Create/update/delete/duplicate helpers that refresh the list on success. */
export function useQueryMutations(profile: string) {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: queriesKey(profile) })
  return {
    create: useMutation({ mutationFn: (b: QueryBody) => createSavedQuery(profile, b), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: number; body: QueryUpdateBody }) => updateSavedQuery(profile, v.id, v.body), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => deleteSavedQuery(profile, id), onSuccess: refresh }),
    duplicate: useMutation({ mutationFn: (id: number) => duplicateSavedQuery(profile, id), onSuccess: refresh }),
  }
}

/** Finds the saved query called `name` (case-insensitive) in the given scope, or undefined. */
export async function findSavedQuery(profile: string, name: string, global: boolean): Promise<SavedQuery | undefined> {
  const { queries } = await api<{ queries: SavedQuery[] }>(`${base(profile)}?q=${encodeURIComponent(name)}`)
  const n = name.toLowerCase()
  return queries.find((q) => q.name.toLowerCase() === n && q.global === global)
}
