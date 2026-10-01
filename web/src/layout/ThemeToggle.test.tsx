import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'
import { useThemeStore, resolveTheme, THEME_COOKIE } from '../store/theme'

describe('theme switching', () => {
  beforeEach(() => useThemeStore.getState().setMode('system'))

  it('cycles system, light, dark and updates data-theme', async () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Theme: System' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await userEvent.click(screen.getByRole('button'))
    expect(useThemeStore.getState().mode).toBe('system')
  })

  it('persists the choice in a cookie', () => {
    useThemeStore.getState().setMode('light')
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`)
  })

  it('follows the OS preference in system mode', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('dark') ? false : true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    expect(resolveTheme('system')).toBe('light')
    window.matchMedia = original
    expect(resolveTheme('dark')).toBe('dark')
  })
})
