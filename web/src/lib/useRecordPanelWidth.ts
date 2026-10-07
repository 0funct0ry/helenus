import { useCallback, useState } from 'react'

const KEY = 'helenus.recordPanelWidth'
export const MIN_RECORD_PANEL = 260
export const MAX_RECORD_PANEL = 720
export const DEFAULT_RECORD_PANEL = 360

export const clampRecordPanel = (w: number) => Math.min(MAX_RECORD_PANEL, Math.max(MIN_RECORD_PANEL, Math.round(w)))

/** Width in px of the record view panel, remembered in localStorage when storage is available. */
export function useRecordPanelWidth(): [number, (w: number) => void] {
  const [w, setW] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(KEY))
      return v ? clampRecordPanel(v) : DEFAULT_RECORD_PANEL
    } catch {
      return DEFAULT_RECORD_PANEL
    }
  })
  const set = useCallback((next: number) => {
    const c = clampRecordPanel(next)
    setW(c)
    try {
      localStorage.setItem(KEY, String(c))
    } catch {
      /* storage unavailable */
    }
  }, [])
  return [w, set]
}
