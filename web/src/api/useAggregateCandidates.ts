import { useEffect, useState } from 'react'
import { api } from './client'
import type { AggregateCandidate } from './types'

/**
 * Functions of a keyspace for the SFUNC (`final` false) or FINALFUNC slot of an aggregate, each marked usable or
 * not with the signature it would need. `nonce` forces a reload, e.g. after a function was created from the
 * builder. Empty until the state type is known.
 */
export function useAggregateCandidates(profile: string, keyspace: string, argTypes: string[], stype: string, final: boolean, nonce = 0): AggregateCandidate[] {
  const [state, setState] = useState<{ key: string; list: AggregateCandidate[] }>({ key: '', list: [] })
  const key = JSON.stringify({ keyspace, arg_types: argTypes, stype, final })
  const full = `${key}|${nonce}`
  useEffect(() => {
    if (!stype) return
    let live = true
    const timer = setTimeout(() => {
      api<{ candidates: AggregateCandidate[] }>(`/p/${encodeURIComponent(profile)}/aggregates/candidates`, { body: JSON.parse(key) })
        .then((r) => live && setState({ key: full, list: r.candidates }))
        .catch(() => live && setState({ key: full, list: [] }))
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [profile, key, full, stype])
  return state.key === full ? state.list : []
}
