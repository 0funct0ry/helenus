import { draftFromProfile, draftToBody, emptyDraft } from './profileDraft'
import { apiProfile } from '../test/api'

describe('profileDraft', () => {
  it('round-trips a saved profile without leaking secrets', () => {
    const d = draftFromProfile(apiProfile({ name: 'p', hosts: ['a', 'b'], port: 9100, password_set: true, tls: { enabled: true, ca_cert: '/c', insecure_skip_verify: false } }))
    expect(d).toMatchObject({ original: 'p', hosts: 'a, b', port: '9100', passwordSet: true, password: '', tlsEnabled: true, caCert: '/c' })
    const body = draftToBody(d, false)
    expect(body).toMatchObject({ hosts: ['a', 'b'], port: 9100, password: '', tls: { enabled: true, ca_cert: '/c' } })
    expect(body.name).toBeUndefined()
  })
  it('includes the name when creating and the cleared secrets', () => {
    const d = { ...emptyDraft(), name: ' x ', clearPassword: true, clearToken: true }
    const body = draftToBody(d, true)
    expect(body.name).toBe('x')
    expect(body.clear_secrets).toEqual(['password', 'token'])
  })
  it('zeroes direct-only fields in Astra mode', () => {
    const body = draftToBody({ ...emptyDraft(), mode: 'astra', bundle: '/b.zip', token: 't' }, true)
    expect(body).toMatchObject({ hosts: [], port: 0, username: '', astra: { secure_bundle: '/b.zip', token: 't' }, tls: { enabled: false } })
  })
})
