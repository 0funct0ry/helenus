import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Field } from '../ui/Field'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { ApiError } from '../api/client'
import { useSaveExportPreset } from '../api/useExport'
import type { ExportFormat, ExportOptions } from '../api/types'

export interface ExportSavePresetDialogProps {
  profile: string
  format: ExportFormat
  options: ExportOptions
  /** Checked columns, or null when every column is checked. */
  columns: string[] | null
  onSaved: (name: string) => void
  onClose: () => void
}

/**
 * "Save as preset…" dialog: asks for a name and stores the format, options and column choice. A preset applies to
 * every profile when "Available for all profiles" is on. A duplicate name shows an error (use "Update preset" to
 * change an existing one). Mount it only while open.
 */
export function ExportSavePresetDialog({ profile, format, options, columns, onSaved, onClose }: ExportSavePresetDialogProps) {
  const save = useSaveExportPreset(profile)
  const [name, setName] = useState('')
  const [global, setGlobal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setError(null)
    try {
      await save.mutateAsync({ name: name.trim(), format, options, columns, global })
      onSaved(name.trim())
      onClose()
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'export_preset_exists' ? `A preset named “${name.trim()}” already exists. Pick another name or use Update preset.` : e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Save export preset"
      width="min(420px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={() => void run()}>
            Save
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <Field label="Preset name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance CSV" autoFocus />
        <Toggle checked={global} onChange={setGlobal}>
          Available for all profiles
        </Toggle>
        {error && (
          <p role="alert" className="mb-0 mt-2 text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
