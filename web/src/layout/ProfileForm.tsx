import { useRef } from 'react'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { Tabs } from '../ui/Tabs'
import { Toggle } from '../ui/Toggle'
import { Button } from '../ui/Button'
import { SecretField } from './SecretField'
import { CONSISTENCY_LEVELS } from './TableView'
import type { ProfileDraft } from '../lib/profileDraft'

export interface ProfileFormProps {
  draft: ProfileDraft
  onChange: (patch: Partial<ProfileDraft>) => void
  /** Called with the chosen bundle file; the parent uploads it and stores the returned path. */
  onPickBundle: (file: File) => void
  uploading?: boolean
  uploadError?: string
}

const section = 'mb-2.5 mt-4 text-xs font-semibold'

/**
 * The profile editing form: name, Direct / Astra tabs, authentication, TLS and defaults. Secret
 * fields are write-only. The Astra tab uploads a secure connect bundle through `onPickBundle`.
 */
export function ProfileForm({ draft: d, onChange, onPickBundle, uploading, uploadError }: ProfileFormProps) {
  const astra = d.mode === 'astra'
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="overflow-auto px-[18px] py-3.5">
      <Field label="Profile name" value={d.name} onChange={(e) => onChange({ name: e.target.value })} />
      <Tabs
        variant="underline"
        aria-label="Connection kind"
        value={d.mode}
        onChange={(mode) => onChange({ mode: mode as ProfileDraft['mode'] })}
        className="mb-3.5"
        items={[
          { id: 'direct', label: 'Direct connection' },
          { id: 'astra', label: 'Astra DB' },
        ]}
      />
      {astra ? (
        <>
          <Field label="Secure connect bundle" mono value={d.bundle} placeholder="~/Downloads/secure-connect-db.zip" onChange={(e) => onChange({ bundle: e.target.value })} />
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="sr-only"
            aria-label="Upload secure connect bundle"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPickBundle(f)
              e.target.value = ''
            }}
          />
          <Button className="mb-3" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload bundle…'}
          </Button>
          {uploadError && <div role="alert" className="mb-3 text-[12.5px] text-danger">{uploadError}</div>}
          <SecretField
            label="Application token"
            value={d.token}
            onChange={(token) => onChange({ token })}
            isSet={d.tokenSet}
            cleared={d.clearToken}
            onClear={(clearToken) => onChange({ clearToken })}
            placeholder="AstraCS:…"
          />
        </>
      ) : (
        <>
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
            <Field label="Contact points" mono value={d.hosts} onChange={(e) => onChange({ hosts: e.target.value })} />
            <Field label="Port" mono inputMode="numeric" value={d.port} onChange={(e) => onChange({ port: e.target.value })} />
            <Field label="Local datacenter" mono value={d.dc} onChange={(e) => onChange({ dc: e.target.value })} />
          </div>
          <h3 className={section}>Authentication</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" mono autoComplete="off" value={d.username} onChange={(e) => onChange({ username: e.target.value })} />
            <SecretField
              label="Password"
              value={d.password}
              onChange={(password) => onChange({ password })}
              isSet={d.passwordSet || d.passwordCommandSet}
              source={d.passwordCommandSet && !d.passwordSet ? 'password command' : undefined}
              cleared={d.clearPassword}
              onClear={(clearPassword) => onChange({ clearPassword })}
            />
          </div>
          <h3 className={section}>TLS</h3>
          <Toggle checked={d.tlsEnabled} onChange={(tlsEnabled) => onChange({ tlsEnabled })} className="-ml-1.5 mb-2.5">
            Encrypt connections with TLS
          </Toggle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CA certificate" mono disabled={!d.tlsEnabled} value={d.caCert} onChange={(e) => onChange({ caCert: e.target.value })} />
            <Field label="Server name (optional)" mono disabled={!d.tlsEnabled} placeholder="Uses each node's address" value={d.serverName} onChange={(e) => onChange({ serverName: e.target.value })} />
            <Field label="Client certificate (mTLS)" mono disabled={!d.tlsEnabled} value={d.cert} onChange={(e) => onChange({ cert: e.target.value })} />
            <Field label="Client key (mTLS)" mono disabled={!d.tlsEnabled} value={d.key} onChange={(e) => onChange({ key: e.target.value })} />
          </div>
          <Toggle checked={d.insecure} onChange={(insecure) => onChange({ insecure })} disabled={!d.tlsEnabled} className="-ml-1.5 mb-2.5">
            Skip certificate verification (insecure)
          </Toggle>
        </>
      )}
      <h3 className={section}>Defaults</h3>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
        <Field label="Keyspace" mono value={d.keyspace} onChange={(e) => onChange({ keyspace: e.target.value })} />
        <div className="mb-3 flex flex-col gap-[5px]">
          <span className="text-xs text-muted">Consistency</span>
          <Select aria-label="Default consistency" mono value={d.consistency} onChange={(consistency) => onChange({ consistency })} options={CONSISTENCY_LEVELS} className="h-7" />
        </div>
        <Field label="Request timeout" mono placeholder="10s" value={d.requestTimeout} onChange={(e) => onChange({ requestTimeout: e.target.value })} />
      </div>
    </div>
  )
}
