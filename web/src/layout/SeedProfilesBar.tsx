import { useState } from 'react'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useDeleteSeedProfile, useSeedProfiles } from '../api/useSeed'
import type { SeedProfile } from '../api/types'

export interface SeedProfilesBarProps {
  profile: string
  keyspace: string
  table: string
  /** Called with the chosen saved profile; the wizard reconciles it with the current schema. */
  onLoad: (p: SeedProfile) => void
  onSave: () => void
}

/**
 * The "Load recipe" Select, "Save as recipe…" and a delete action for this table's saved seed configurations (recipes).
 * Deleting asks for confirmation.
 */
export function SeedProfilesBar({ profile, keyspace, table, onLoad, onSave }: SeedProfilesBarProps) {
  const { data: profiles = [] } = useSeedProfiles(profile, keyspace, table)
  const del = useDeleteSeedProfile(profile, keyspace, table)
  const [selected, setSelected] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const current = profiles.find((p) => String(p.id) === selected)
  return (
    <div className="mb-3 flex items-center gap-2">
      <Select
        aboveDialog
        label="Load recipe"
        value={selected}
        options={profiles.length ? profiles.map((p) => ({ value: String(p.id), label: p.name })) : [{ value: '', label: 'No saved recipes', disabled: true }]}
        onChange={(id) => {
          setSelected(id)
          const p = profiles.find((x) => String(x.id) === id)
          if (p) onLoad(p)
        }}
      />
      <Button disabled={!current} onClick={() => setConfirmDelete(true)}>
        Delete recipe
      </Button>
      <div className="flex-1" />
      <Button onClick={onSave}>Save as recipe…</Button>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete recipe?"
        message={`Delete the saved recipe “${current?.name ?? ''}”?`}
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
