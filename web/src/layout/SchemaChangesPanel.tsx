import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { SchemaChangeRow } from './SchemaChangeRow'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'
import { useClearSchemaChanges, useSchemaChanges } from '../api/hooks'
import { describeError } from '../api/client'
import { useWorkspace } from '../store/workspace'
import { useToasts } from '../store/toast'

const SEARCH_DEBOUNCE_MS = 250

/**
 * The "Schema changes" dock tab: the active profile's UI-issued DDL, newest first, with a search box, expandable
 * entries (see SchemaChangeRow) and infinite scroll in pages of 50 (a "Load more" button is the fallback). The
 * Clear history button asks for confirmation and removes only this profile's entries.
 */
export function SchemaChangesPanel() {
  const profileId = useWorkspace((s) => s.profileId)
  const newQuery = useWorkspace((s) => s.newQuery)
  const pushToast = useToasts((s) => s.push)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const { data, error, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useSchemaChanges(profileId, q)
  const clear = useClearSchemaChanges(profileId)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text])

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length])

  return (
    <section aria-label="Schema changes" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line2 py-1.5 pl-3 pr-2">
        <h2 className="m-0 text-[13px] font-medium">Schema changes</h2>
        <span className="flex-1" />
        <IconButton label="Clear history" icon={<Trash2 size={14} />} disabled={items.length === 0 || clear.isPending} onClick={() => setConfirmClear(true)} />
      </div>
      <label className="m-2 flex h-[26px] items-center gap-1.5 rounded border border-line bg-editor px-2 text-muted focus-within:border-focus">
        <Search size={14} aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search statements and objects"
          aria-label="Search schema changes"
          className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-faint"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {error ? (
          <p role="alert" className="m-0 px-3 py-4 text-muted">
            Could not read the history: {describeError(error)}
          </p>
        ) : isLoading ? (
          <p className="m-0 px-3 py-4 text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="m-0 px-3 py-4 text-muted">{q ? 'No changes match the search.' : 'No schema changes yet. DDL you run from the UI shows up here.'}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((c) => (
              <SchemaChangeRow
                key={c.id}
                change={c}
                expanded={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                onCopyStatement={() => {
                  void navigator.clipboard?.writeText(c.statement)
                  pushToast('Statement copied')
                }}
                onOpenReverse={() => newQuery({ keyspace: c.keyspace, cql: c.reverse })}
              />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <div ref={sentinel} className="p-2 text-center">
            <button type="button" className="text-accent hover:underline disabled:opacity-50" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmClear}
        title="Clear schema change history"
        message={`Delete all schema change entries for profile ${profileId}? Other profiles keep theirs. This cannot be undone.`}
        confirmLabel="Clear history"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          clear.mutate()
        }}
      />
    </section>
  )
}
