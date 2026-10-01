import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ProfileForm } from './ProfileForm'
import { ProfileListPane } from './ProfileListPane'
import { ConnectionTestResult } from './ConnectionTestResult'
import { describeError } from '../api/client'
import { useConnect, useDeleteProfile, useProfiles, useSaveProfile, useTestProfile, useUploadBundle } from '../api/hooks'
import { draftFromProfile, draftToBody, emptyDraft } from '../lib/profileDraft'
import type { ProfileDraft } from '../lib/profileDraft'
import { useWorkspace } from '../store/workspace'

/**
 * Lists saved profiles and edits one at a time: Save writes config.yaml through the API, Test
 * connection tests the current (unsaved) form values, Delete asks for confirmation. Secrets are
 * write-only, so editing a profile never needs them re-entered.
 */
export function ProfileManager() {
  const setOpen = useWorkspace((s) => s.setProfileDialogOpen)
  const current = useWorkspace((s) => s.profileId)
  const setProfile = useWorkspace((s) => s.setProfile)
  const connections = useWorkspace((s) => s.connections)
  const { data, isPending } = useProfiles()
  const profiles = useMemo(() => data ?? [], [data])
  const save = useSaveProfile()
  const del = useDeleteProfile()
  const test = useTestProfile()
  const upload = useUploadBundle()
  const connect = useConnect()

  // `null` selection means "the current profile, or New when none exist".
  const [selection, setSelection] = useState<string | null>(null)
  const [edits, setEdits] = useState<ProfileDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveError, setSaveError] = useState('')

  const selected = selection === null ? (profiles.find((p) => p.name === current)?.name ?? profiles[0]?.name) : selection || undefined
  const saved = profiles.find((p) => p.name === selected)
  const base = useMemo(() => (saved ? draftFromProfile(saved) : emptyDraft()), [saved])
  const draft = edits ?? base

  const resetPanels = () => {
    setEdits(null)
    setSaveError('')
    test.reset()
    upload.reset()
  }
  const select = (name: string) => {
    setSelection(name)
    resetPanels()
  }

  const onSave = () => {
    setSaveError('')
    const renamed = !!draft.original && draft.name.trim() !== draft.original
    save.mutate(
      { original: draft.original, body: draftToBody(draft, !draft.original || renamed) },
      {
        onSuccess: (p) => {
          setSelection(p.name)
          setEdits(null)
          setProfile(p.name)
          connect.mutate(p.name)
          setOpen(false)
        },
        onError: (e) => setSaveError(describeError(e)),
      },
    )
  }

  return (
    <>
      <Dialog
        open
        onClose={() => setOpen(false)}
        title="Connection profiles"
        footer={
          <>
            <Button variant="danger" icon={<Trash2 size={14} />} disabled={!saved} onClick={() => setConfirmDelete(true)}>
              Delete profile
            </Button>
            {saveError && (
              <div role="alert" className="ml-2 min-w-0 truncate text-[12.5px] text-danger" title={saveError}>
                {saveError}
              </div>
            )}
            <div className="flex-1" />
            <Button
              disabled={test.isPending}
              onClick={() => test.mutate({ ...draftToBody(draft, false), name: draft.original || undefined })}
            >
              {test.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button variant="primary" disabled={save.isPending || !draft.name.trim()} onClick={onSave}>
              Save profile
            </Button>
          </>
        }
      >
        <div className="grid h-[min(480px,60vh)] min-h-0 grid-cols-[210px_1fr]">
          <ProfileListPane
            profiles={profiles}
            selected={saved?.name}
            connections={connections}
            onSelect={select}
            onNew={() => {
              setSelection('')
              resetPanels()
            }}
          />
          <div className="min-h-0 overflow-auto">
            {isPending ? (
              <div className="p-[18px] text-muted">Loading profiles…</div>
            ) : (
              <ProfileForm
                key={draft.original || 'new'}
                draft={draft}
                onChange={(patch) => setEdits({ ...draft, ...patch })}
                onPickBundle={(file) =>
                  upload.mutate(file, {
                    onSuccess: (info) => setEdits({ ...draft, bundle: info.path, keyspace: draft.keyspace || info.keyspace }),
                  })
                }
                uploading={upload.isPending}
                uploadError={upload.error ? describeError(upload.error) : undefined}
              />
            )}
            <div className="px-[18px] pb-3.5">
              <ConnectionTestResult result={test.data} error={test.error ? describeError(test.error) : undefined} />
            </div>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete profile"
        message={`Delete the profile "${saved?.name ?? ''}"? This removes it from config.yaml and cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          if (saved) {
            del.mutate(saved.name, {
              onSuccess: () => {
                if (current === saved.name) setProfile('')
                setSelection(null)
                resetPanels()
              },
              onError: (e) => setSaveError(describeError(e)),
            })
          }
        }}
      />
    </>
  )
}
