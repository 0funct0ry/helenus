import { useEffect, useRef } from 'react'
import { TitleBar } from './layout/TitleBar'
import { SidebarResizer } from './layout/SidebarResizer'
import { useSidebarWidth } from './lib/useSidebarWidth'
import { LeftDock } from './layout/LeftDock'
import { SecurityView } from './layout/SecurityView'
import { TabBar } from './layout/TabBar'
import { TableView } from './layout/TableView'
import { QueryView } from './layout/QueryView'
import { AggregateView } from './layout/AggregateView'
import { FunctionView } from './layout/FunctionView'
import { TypeView } from './layout/TypeView'
import { StatusBar } from './layout/StatusBar'
import { CommandPalette } from './layout/CommandPalette'
import { ProfileDialog } from './layout/ProfileDialog'
import { ReviewDataModelDialog } from './layout/ReviewDataModelDialog'
import { ToastViewport } from './ui/ToastViewport'
import { useBootstrapProfile } from './api/useBootstrap'
import { useSchema } from './api/hooks'
import { useWorkspace } from './store/workspace'
import { initTheme } from './store/theme'
import { SignInScreen } from './layout/SignInScreen'
import { useAuthGate } from './api/useAuth'
import { useUiStateSync } from './api/useUiStateSync'
import { useSession } from './store/session'
import { QueryDialogs } from './layout/QueryDialogs'
import { useQueryActions } from './api/useQueryActions'
import { isDirtyTab } from './lib/queryDirty'

/**
 * Application shell: title bar, schema dock, tab bar with the active tab's view, status bar and the
 * global overlays. Registers Cmd/Ctrl-K for the command palette and applies the theme on mount.
 */
export function App() {
  const tabs = useWorkspace((s) => s.tabs)
  const edits = useWorkspace((s) => s.edits)
  const activeId = useWorkspace((s) => s.activeId)
  const activate = useWorkspace((s) => s.activate)
  const queryStates = useWorkspace((s) => s.queryStates)
  const editorEpochs = useWorkspace((s) => s.editorEpochs)
  const actions = useQueryActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const closeMany = useWorkspace((s) => s.closeMany)
  const newQuery = useWorkspace((s) => s.newQuery)
  const profileId = useWorkspace((s) => s.profileId)
  const reviewKeyspace = useWorkspace((s) => s.reviewKeyspace)
  const setReviewKeyspace = useWorkspace((s) => s.setReviewKeyspace)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces } = useSchema(profileId, connected)
  const isSystemTab = (t: { kind: string; keyspace: string }) =>
    (t.kind === 'table' || t.kind === 'view') && !!keyspaces?.find((k) => k.name === t.keyspace)?.system
  const active = tabs.find((t) => t.id === activeId)
  useBootstrapProfile()
  const [sidebarW, setSidebarW] = useSidebarWidth()
  const { authEnabled, user, needsSignIn } = useAuthGate()
  const expired = useSession((s) => s.expired)
  useUiStateSync(authEnabled && !!user && !needsSignIn, profileId)

  useEffect(() => initTheme(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const s = useWorkspace.getState()
        s.setPaletteOpen(!s.paletteOpen)
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's' && !e.defaultPrevented) {
        const s = useWorkspace.getState()
        if (s.tabs.find((t) => t.id === s.activeId)?.kind !== 'query') return
        e.preventDefault()
        if (e.shiftKey) actionsRef.current.saveAs(s.activeId)
        else void actionsRef.current.save(s.activeId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="grid h-full grid-rows-[34px_1fr_24px]">
      {needsSignIn && <SignInScreen expired={expired && !!user} />}
      <TitleBar />
      <div
        className={`grid min-h-0 ${sidebarW === null ? 'grid-cols-[220px_1fr] min-[1100px]:grid-cols-[264px_1fr]' : ''}`}
        style={sidebarW === null ? undefined : { gridTemplateColumns: `${sidebarW}px 1fr` }}
      >
        <div className="relative grid min-h-0 min-w-0">
          <LeftDock />
          <SidebarResizer
            width={sidebarW ?? (window.innerWidth >= 1100 ? 264 : 220)}
            onResize={setSidebarW}
            onReset={() => setSidebarW(null)}
          />
        </div>
        <main className="flex min-h-0 min-w-0 flex-col">
          <TabBar
            tabs={tabs.map((t) => {
              const dirty = isDirtyTab(t, queryStates[t.id])
              return { ...t, dirty, modified: dirty || (edits[t.id]?.length ?? 0) > 0, readOnly: isSystemTab(t), tooltip: t.queryName ? `${t.queryName}${t.queryGlobal ? ' (Global)' : ''}` : undefined }
            })}
            activeId={activeId}
            onSelect={activate}
            onClose={actions.requestClose} onCloseMany={closeMany} onNew={() => newQuery()} />
          {active?.kind === 'table' || active?.kind === 'view' ? (
            <TableView key={active.id} tab={active} />
          ) : active?.kind === 'query' ? (
            <QueryView key={`${active.id}:${editorEpochs[active.id] ?? 0}`} tab={active} />
          ) : active?.kind === 'type' ? (
            <TypeView key={active.id} tab={active} />
          ) : active?.kind === 'aggregate' ? (
            <AggregateView key={active.id} tab={active} />
          ) : active?.kind === 'security' ? (
            <SecurityView key={active.id} />
          ) : active?.kind === 'function' ? (
            <FunctionView key={active.id} tab={active} />
          ) : (
            <div className="grid flex-1 place-items-center text-muted">Open a table from the schema tree, or press ⌘K.</div>
          )}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <QueryDialogs />
      <ProfileDialog />
      <ReviewDataModelDialog profile={profileId} keyspace={reviewKeyspace} onClose={() => setReviewKeyspace(null)} />
      <ToastViewport />
    </div>
  )
}
