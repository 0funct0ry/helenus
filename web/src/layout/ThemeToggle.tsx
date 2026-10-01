import { Monitor, Moon, Sun } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { useThemeStore } from '../store/theme'

const LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const

/** Title-bar button that cycles the theme System, Light, Dark. The icon and label show the current mode. */
export function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode)
  const cycle = useThemeStore((s) => s.cycle)
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor
  return <IconButton label={`Theme: ${LABEL[mode]}`} icon={<Icon size={14} />} onClick={cycle} />
}
