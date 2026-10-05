import { useState } from 'react'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useDeleteExportPreset, useExportPresets, useUpdateExportPreset } from '../api/useExport'
import { ExportSavePresetDialog } from './ExportSavePresetDialog'
import type { ExportFormat, ExportOptions, ExportPreset } from '../api/types'

export interface ExportPresetBarProps {
  profile: string
  format: ExportFormat
  options: ExportOptions
  /** Checked columns, or null when every column is checked. */
  columns: string[] | null
  /** Called with the chosen preset; the dialog applies it to the current table. */
  onLoad: (p: ExportPreset) => void
}

/**
 * Preset controls of the export dialog: "Load preset" (this profile's and shared presets), "Save as preset…",
 * "Update preset" (overwrites the loaded preset with the current choices) and "Delete preset" (asks first).
 */
export function ExportPresetBar({ profile, format, options, columns, onLoad }: ExportPresetBarProps) {
  const { data: presets = [] } = useExportPresets(profile)
  const update = useUpdateExportPreset(profile)
  const del = useDeleteExportPreset(profile)
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const current = presets.find((p) => String(p.id) === selected)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aboveDialog
        label="Load preset"
        value={selected}
        options={presets.length ? presets.map((p) => ({ value: String(p.id), label: p.profile ? p.name : `${p.name} (all profiles)` })) : [{ value: '', label: 'No saved presets', disabled: true }]}
        onChange={(id) => {
          setSelected(id)
          const p = presets.find((x) => String(x.id) === id)
          if (p) onLoad(p)
        }}
      />
      <Button onClick={() => setSaving(true)}>Save as preset…</Button>
      <Button disabled={!current || update.isPending} onClick={() => current && update.mutate({ id: current.id, body: { name: current.name, format, options, columns } })}>
        Update preset
      </Button>
      <Button disabled={!current} onClick={() => setConfirmDelete(true)}>
        Delete preset
      </Button>
      {saving && <ExportSavePresetDialog profile={profile} format={format} options={options} columns={columns} onSaved={() => undefined} onClose={() => setSaving(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete preset?"
        message={`Delete the export preset “${current?.name ?? ''}”?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (current) del.mutate(current.id)
          setSelected('')
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
