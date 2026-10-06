import { useCallback, useState } from 'react'
import { clampSidebar } from '../layout/SidebarResizer'

const KEY = 'helenus.sidebarWidth'

/** Sidebar width in px (null = responsive default), persisted to localStorage when storage is available. */
export function useSidebarWidth(): [number | null, (w: number | null) => void] {
  const [w, setW] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(KEY))
      return v ? clampSidebar(v) : null
    } catch {
      return null
    }
  })
  const set = useCallback((next: number | null) => {
    setW(next)
    try {
      if (next === null) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, String(next))
    } catch {
      /* storage unavailable */
    }
  }, [])
  return [w, set]
}
