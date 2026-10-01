import type { ApiProfile } from '../api/types'

/** Editable form state for one profile. Secrets are write-only: `password` holds only a newly typed value. */
export interface ProfileDraft {
  /** Name of the saved profile being edited; empty for a new profile. */
  original: string
  name: string
  mode: 'direct' | 'astra'
  hosts: string
  port: string
  dc: string
  username: string
  password: string
  passwordSet: boolean
  passwordCommandSet: boolean
  clearPassword: boolean
  tlsEnabled: boolean
  caCert: string
  cert: string
  key: string
  serverName: string
  insecure: boolean
  bundle: string
  token: string
  tokenSet: boolean
  clearToken: boolean
  keyspace: string
  consistency: string
  requestTimeout: string
}

export const NEW_PROFILE = '\u0000new'

/** A blank draft for "New profile". */
export function emptyDraft(): ProfileDraft {
  return {
    original: '', name: '', mode: 'direct', hosts: '127.0.0.1', port: '9042', dc: '', username: '', password: '', passwordSet: false,
    passwordCommandSet: false, clearPassword: false, tlsEnabled: false, caCert: '', cert: '', key: '', serverName: '', insecure: false,
    bundle: '', token: '', tokenSet: false, clearToken: false, keyspace: '', consistency: 'LOCAL_ONE', requestTimeout: '',
  }
}

/** Build a draft from a saved profile. */
export function draftFromProfile(p: ApiProfile): ProfileDraft {
  return {
    original: p.name, name: p.name, mode: p.astra.secure_bundle ? 'astra' : 'direct', hosts: p.hosts.join(', '), port: String(p.port),
    dc: p.dc ?? '', username: p.username ?? '', password: '', passwordSet: p.password_set, passwordCommandSet: p.password_command_set,
    clearPassword: false, tlsEnabled: p.tls.enabled, caCert: p.tls.ca_cert ?? '', cert: p.tls.cert ?? '', key: p.tls.key ?? '',
    serverName: p.tls.server_name ?? '', insecure: p.tls.insecure_skip_verify, bundle: p.astra.secure_bundle ?? '', token: '',
    tokenSet: p.token_set || p.token_command_set, clearToken: false, keyspace: p.keyspace ?? '', consistency: p.consistency ?? 'LOCAL_ONE',
    requestTimeout: p.request_timeout ?? '',
  }
}

/**
 * Convert a draft to the API body. Empty strings clear optional keys on update; `includeName` is set when the
 * body creates or renames a profile. Typed secrets are sent; untouched secrets are omitted so the server keeps them.
 */
export function draftToBody(d: ProfileDraft, includeName: boolean): Record<string, unknown> {
  const astra = d.mode === 'astra'
  const clear: string[] = []
  if (d.clearPassword) clear.push('password')
  if (d.clearToken) clear.push('token')
  const body: Record<string, unknown> = {
    hosts: astra ? [] : d.hosts.split(',').map((h) => h.trim()).filter(Boolean),
    port: astra ? 0 : Number.parseInt(d.port, 10) || 0,
    dc: d.dc.trim(),
    keyspace: d.keyspace.trim(),
    consistency: d.consistency,
    username: astra ? '' : d.username.trim(),
    password: d.password,
    tls: {
      enabled: !astra && d.tlsEnabled,
      ca_cert: d.caCert.trim(),
      cert: d.cert.trim(),
      key: d.key.trim(),
      server_name: d.serverName.trim(),
      insecure_skip_verify: d.insecure,
    },
    astra: { secure_bundle: astra ? d.bundle.trim() : '', token: d.token },
    request_timeout: d.requestTimeout.trim(),
    clear_secrets: clear,
  }
  if (includeName) body.name = d.name.trim()
  return body
}
