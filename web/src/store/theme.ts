import { create } from 'zustand'
import { readCookie, writeCookie } from '../lib/cookie'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_COOKIE = 'helenus_theme'
const ORDER: ThemeMode[] = ['system', 'light', 'dark']

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode
}

function apply(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
}

function initialMode(): ThemeMode {
  const c = readCookie(THEME_COOKIE)
  return c === 'light' || c === 'dark' || c === 'system' ? c : 'system'
}

interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  cycle: () => void
  /** Re-reads the OS preference; call from a media-query listener. */
  refresh: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const mode = initialMode()
  return {
    mode,
    resolved: resolveTheme(mode),
    setMode: (next) => {
      writeCookie(THEME_COOKIE, next)
      const resolved = resolveTheme(next)
      apply(resolved)
      set({ mode: next, resolved })
    },
    cycle: () => get().setMode(ORDER[(ORDER.indexOf(get().mode) + 1) % ORDER.length]),
    refresh: () => {
      const resolved = resolveTheme(get().mode)
      apply(resolved)
      set({ resolved })
    },
  }
})

/** Applies the stored theme to <html> and follows OS changes while in system mode. */
export function initTheme(): () => void {
  useThemeStore.getState().refresh()
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => useThemeStore.getState().refresh()
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
