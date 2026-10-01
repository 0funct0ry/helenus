import { useState } from 'react'
import { Check, Lock, Plus, Trash2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Tabs } from '../ui/Tabs'
import { Toggle } from '../ui/Toggle'
import { Select } from '../ui/Select'
import { StatusDot } from '../ui/StatusDot'
import { CONSISTENCY_LEVELS } from './TableView'
import { profiles } from '../mocks/profiles'
import { useWorkspace } from '../store/workspace'

/**
 * Connection profiles dialog shell: a profile list on the left and a (non-persisting) form on the
 * right with connection, authentication, TLS and defaults sections. Controlled by the workspace store.
 */
export function ProfileDialog() {
  const open = useWorkspace((s) => s.profileDialogOpen)
  const setOpen = useWorkspace((s) => s.setProfileDialogOpen)
  const current = useWorkspace((s) => s.profileId)
  const [selected, setSelected] = useState(current)
  const [mode, setMode] = useState('direct')
  const [tls, setTls] = useState(true)
  const [cl, setCl] = useState('LOCAL_QUORUM')
  const p = profiles.find((x) => x.id === selected) ?? profiles[0]

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Connection profiles"
      footer={
        <>
          <Button variant="danger" icon={<Trash2 size={14} />}>
            Delete profile
          </Button>
          {p.status === 'connected' && (
            <div className="ml-2 flex items-center gap-1.5 text-[12.5px] text-ok">
              <Check size={14} aria-hidden />
              Connected in 42 ms<span className="text-muted">Cassandra 5.0.2, 2 datacenters, 6 nodes</span>
            </div>
          )}
          {p.status === 'error' && <div className="ml-2 text-[12.5px] text-danger">{p.error}</div>}
          <div className="flex-1" />
          <Button>Test connection</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Save profile
          </Button>
        </>
      }
    >
      <div className="grid h-[min(480px,60vh)] min-h-0 grid-cols-[210px_1fr]">
        <div role="listbox" aria-label="Profiles" className="overflow-auto border-r border-line2 bg-surface p-1.5">
          {profiles.map((x) => (
            <button
              key={x.id}
              role="option"
              aria-selected={x.id === selected}
              onClick={() => setSelected(x.id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${x.id === selected ? 'bg-selected' : ''}`}
            >
              <StatusDot status={x.status} />
              <div>
                {x.name}
                <small className="block font-mono text-[11.5px] text-faint">{x.hosts}</small>
              </div>
            </button>
          ))}
          <Button variant="ghost" className="mt-1.5 w-full" icon={<Plus size={14} />}>
            New profile
          </Button>
        </div>
        <div className="overflow-auto px-[18px] py-3.5">
          <Field label="Profile name" key={`n-${p.id}`} defaultValue={p.name} />
          <Tabs variant="underline" aria-label="Connection kind" value={mode} onChange={setMode} className="mb-3.5" items={[{ id: 'direct', label: 'Direct connection' }, { id: 'astra', label: 'Astra DB' }]} />
          {mode === 'direct' ? (
            <>
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
                <Field label="Contact points" mono key={`h-${p.id}`} defaultValue={p.id === 'prod-eu' ? '10.20.0.11, 10.20.0.12' : p.hosts} />
                <Field label="Port" mono defaultValue="9042" />
                <Field label="Local datacenter" mono defaultValue="eu-west-1" />
              </div>
              <h3 className="mb-2.5 mt-4 text-xs font-semibold">Authentication</h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username" mono defaultValue="app_reader" />
                <div className="mb-3 flex flex-col gap-[5px]">
                  <span className="text-xs text-muted">Password</span>
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-7 flex-1 items-center gap-1.5 rounded border border-dashed border-line px-2 text-muted">
                      <Lock size={12} aria-hidden />
                      Set from password command
                    </span>
                    <Button>Change</Button>
                  </div>
                </div>
              </div>
              <h3 className="mb-2.5 mt-4 text-xs font-semibold">TLS</h3>
              <Toggle checked={tls} onChange={setTls} className="-ml-1.5 mb-2.5">
                Encrypt connections with TLS
              </Toggle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CA certificate" mono defaultValue="~/.certs/prod-ca.pem" disabled={!tls} />
                <Field label="Server name (optional)" mono placeholder="Uses each node's address" disabled={!tls} />
              </div>
              <h3 className="mb-2.5 mt-4 text-xs font-semibold">Defaults</h3>
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
                <Field label="Keyspace" mono defaultValue="payments" />
                <div className="mb-3 flex flex-col gap-[5px]">
                  <span className="text-xs text-muted">Consistency</span>
                  <Select aria-label="Default consistency" mono value={cl} onChange={setCl} options={CONSISTENCY_LEVELS} className="h-7" />
                </div>
                <Field label="Request timeout" mono defaultValue="15s" />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Secure connect bundle" mono placeholder="~/Downloads/secure-connect-db.zip" />
              <Field label="Application token" mono placeholder="Read from the environment" />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
