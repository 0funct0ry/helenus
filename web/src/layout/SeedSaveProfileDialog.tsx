import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Field } from '../ui/Field'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ApiError } from '../api/client'
import { useSaveSeedProfile } from '../api/useSeed'
import type { SeedConfig } from '../api/types'

export interface SeedSaveProfileDialogProps {
  profile: string
  keyspace: string
  table: string
  config: SeedConfig
  onSaved: (name: string) => void
  onClose: () => void
}

/**
 * "Save as recipe…" dialog: asks for a name and saves the configuration for this table. When the name already
 * exists, a confirmation asks before the saved recipe is overwritten. Mount it only while open.
 */
export function SeedSaveProfileDialog({ profile, keyspace, table, config, onSaved, onClose }: SeedSaveProfileDialogProps) {
  const save = useSaveSeedProfile(profile, keyspace, table)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)

  const run = async (overwrite: boolean) => {
    setError(null)
    try {
      await save.mutateAsync({ name: name.trim(), config, overwrite })
      onSaved(name.trim())
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'seed_profile_exists') setConfirmOverwrite(true)
      else setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title="Save seed recipe"
        width="min(420px, 94vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={() => void run(false)}>
              Save
            </Button>
          </>
        }
      >
        <div className="px-5 py-3">
          <Field label="Recipe name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 100k users" autoFocus />
          {error && (
            <p role="alert" className="m-0 text-danger">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmOverwrite}
        title="Overwrite recipe?"
        message={`A recipe named “${name.trim()}” already exists for this table. Replace it?`}
        confirmLabel="Overwrite"
        danger
        onConfirm={() => {
          setConfirmOverwrite(false)
          void run(true)
        }}
        onCancel={() => setConfirmOverwrite(false)}
      />
    </>
  )
}
