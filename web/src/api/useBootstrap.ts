import { useEffect, useRef } from 'react'
import { useConnect, useProfiles } from './hooks'
import { useWorkspace } from '../store/workspace'

/**
 * On first load, activate the `default` profile (or the first one) and connect it. Runs once, so
 * deleting the active profile later does not silently reconnect something else.
 */
export function useBootstrapProfile() {
  const { data: profiles } = useProfiles()
  const connect = useConnect()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !profiles?.length) return
    done.current = true
    const s = useWorkspace.getState()
    if (s.profileId) return
    const pick = profiles.find((p) => p.name === 'default') ?? profiles[0]
    s.setProfile(pick.name)
    connect.mutate(pick.name)
  }, [profiles, connect])
}
