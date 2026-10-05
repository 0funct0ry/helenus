import { useEffect } from 'react'
import { TitleBar } from './layout/TitleBar'
import { LeftDock } from './layout/LeftDock'
import { TabBar } from './layout/TabBar'
import { TableView } from './layout/TableView'
import { QueryView } from './layout/QueryView'
import { AggregateView } from './layout/AggregateView'
import { FunctionView } from './layout/FunctionView'
import { TypeView } from './layout/TypeView'
import { StatusBar } from './layout/StatusBar'
import { CommandPalette } from './layout/CommandPalette'
import { ProfileDialog } from './layout/ProfileDialog'
import { ToastViewport } from './ui/ToastViewport'
import { useBootstrapProfile } from './api/useBootstrap'
import { useWorkspace } from './store/workspace'
import { initTheme } from './store/theme'

/**
 * Application shell: title bar, schema dock, tab bar with the active tab's view, status bar and the
 * global overlays. Registers Cmd/Ctrl-K for the command palette and applies the theme on mount.
 */
export function App() {
  const tabs = useWorkspace((s) => s.tabs)
  const edits = useWorkspace((s) => s.edits)
  const activeId = useWorkspace((s) => s.activeId)
  const activate = useWorkspace((s) => s.activate)
  const close = useWorkspace((s) => s.close)
  const newQuery = useWorkspace((s) => s.newQuery)
  const active = tabs.find((t) => t.id === activeId)
  useBootstrapProfile()

  useEffect(() => initTheme(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const s = useWorkspace.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="grid h-full grid-rows-[34px_1fr_24px]">
      <TitleBar />
      <div className="grid min-h-0 grid-cols-[220px_1fr] min-[1100px]:grid-cols-[264px_1fr]">
        <LeftDock />
        <main className="flex min-h-0 min-w-0 flex-col">
          <TabBar tabs={tabs.map((t) => ({ ...t, modified: (edits[t.id]?.length ?? 0) > 0 }))} activeId={activeId} onSelect={activate} onClose={close} onNew={() => newQuery()} />
          {active?.kind === 'table' || active?.kind === 'view' ? (
            <TableView key={active.id} tab={active} />
          ) : active?.kind === 'query' ? (
            <QueryView key={active.id} tab={active} />
          ) : active?.kind === 'type' ? (
            <TypeView key={active.id} tab={active} />
          ) : active?.kind === 'aggregate' ? (
            <AggregateView key={active.id} tab={active} />
          ) : active?.kind === 'function' ? (
            <FunctionView key={active.id} tab={active} />
          ) : (
            <div className="grid flex-1 place-items-center text-muted">Open a table from the schema tree, or press ⌘K.</div>
          )}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <ProfileDialog />
      <ToastViewport />
    </div>
  )
}
