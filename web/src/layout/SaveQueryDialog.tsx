import { useMemo, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Field } from '../ui/Field'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ApiError, describeError } from '../api/client'
import { createSavedQuery, findSavedQuery, getSavedQuery, updateSavedQuery, useQueries, queriesKey } from '../api/useQueries'
import type { SavedQuery } from '../api/useQueries'
import { folderOf, folderPaths, lastSegment, normalizeQueryName, validateQueryName } from '../lib/queryName'
import { useQueryClient } from '@tanstack/react-query'

export interface SaveQueryDialogProps {
  profile: string
  /** `save` stores `text` as a new query (Save as); `rename` renames or moves the `existing` query. */
  mode?: 'save' | 'rename'
  /** Text to store (save mode). */
  text?: string
  /** Query being renamed or moved (rename mode). */
  existing?: SavedQuery
  /** Prefilled name: the bound name, "<name> copy", or empty. */
  initialName?: string
  initialGlobal?: boolean
  onSaved: (row: SavedQuery) => void
  onClose: () => void
}

/**
 * Save as / Rename-or-move dialog for the query library. Name is a folder path (`reports/daily`); the Folder picker
 * lists existing folders and swaps the name's folder prefix. "Global (all profiles)" stores the query for every
 * profile. Names are validated inline. When the name already exists in the same scope (save mode), the dialog offers
 * Replace, which asks once more and then overwrites that query using its current version. Mount it only while open.
 */
export function SaveQueryDialog({ profile, mode = 'save', text = '', existing, initialName = '', initialGlobal, onSaved, onClose }: SaveQueryDialogProps) {
  const rename = mode === 'rename'
  const qc = useQueryClient()
  const { data: list = [] } = useQueries(profile)
  const [name, setName] = useState(initialName)
  const [global, setGlobal] = useState(initialGlobal ?? existing?.global ?? false)
  const [serverExists, setServerExists] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const norm = normalizeQueryName(name)
  const invalid = name.trim() === '' ? null : validateQueryName(name)
  const listClash = norm !== '' && list.some((q) => q.name.toLowerCase() === norm.toLowerCase() && q.global === global && q.id !== existing?.id)
  const clash = !invalid && norm !== '' && (listClash || serverExists)
  const folder = folderOf(norm).replace(/\/$/, '')
  const folders = useMemo(() => {
    const all = folderPaths(list.map((q) => q.name))
    return folder && !all.includes(folder) ? [...all, folder] : all
  }, [list, folder])

  const edit = (n: string, g = global) => {
    setName(n)
    setGlobal(g)
    setServerExists(false)
    setError(null)
  }
  const pickFolder = (f: string) => edit(`${f ? `${f}/` : ''}${lastSegment(name)}`)

  const finish = (row: SavedQuery) => {
    void qc.invalidateQueries({ queryKey: queriesKey(profile) })
    onSaved(row)
    onClose()
  }
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'query_exists') setServerExists(true)
    else if (e instanceof ApiError && e.code === 'invalid_name') setError(e.message)
    else if (e instanceof ApiError && e.code === 'query_conflict') setError('This query was changed elsewhere. Close this dialog and try again.')
    else setError(describeError(e))
  }

  const submit = async () => {
    if (invalid || norm === '' || clash || busy) return
    setBusy(true)
    setError(null)
    try {
      if (rename && existing) {
        const cur = await getSavedQuery(profile, existing.id)
        finish(await updateSavedQuery(profile, existing.id, { name: norm, text: cur.text ?? '', global, version: cur.version }))
      } else {
        finish(await createSavedQuery(profile, { name: norm, text, global }))
      }
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const replace = async () => {
    setConfirmReplace(false)
    setBusy(true)
    setError(null)
    try {
      const found = await findSavedQuery(profile, norm, global)
      if (!found) {
        finish(await createSavedQuery(profile, { name: norm, text, global }))
        return
      }
      const cur = await getSavedQuery(profile, found.id)
      finish(await updateSavedQuery(profile, found.id, { name: norm, text, global, version: cur.version }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={rename ? 'Rename or move query' : 'Save query'}
        width="min(440px, 94vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            {clash && !rename && (
              <Button variant="danger" className="border-line" disabled={busy} onClick={() => setConfirmReplace(true)}>
                Replace
              </Button>
            )}
            <Button variant="primary" disabled={busy || norm === '' || !!invalid || !!clash} onClick={() => void submit()}>
              {rename ? 'Rename' : 'Save'}
            </Button>
          </>
        }
      >
        <form className="px-5 py-3" onSubmit={(e) => e.preventDefault()}>
          <Field label="Name" value={name} onChange={(e) => edit(e.target.value)} placeholder="e.g. reports/daily payments" autoFocus aria-invalid={!!invalid || !!clash} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void submit())} />
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-muted">Folder</span>
            <Select aria-label="Folder" value={folder} onChange={pickFolder} aboveDialog options={[{ value: '', label: '(no folder)' }, ...folders.map((f) => ({ value: f, label: f }))]} />
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={global} onChange={(e) => edit(name, e.target.checked)} />
            Global (all profiles)
          </label>
          {(invalid || clash || error) && (
            <p role="alert" className="mb-0 mt-2 text-danger">
              {invalid ?? (clash ? `A query named “${norm}” already exists${rename ? '.' : '. Pick another name or choose Replace.'}` : error)}
            </p>
          )}
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmReplace}
        title="Replace saved query?"
        message={`This overwrites the saved text of “${norm}” with the text of this tab.`}
        confirmLabel="Replace"
        danger
        onConfirm={() => void replace()}
        onCancel={() => setConfirmReplace(false)}
      />
    </>
  )
}
