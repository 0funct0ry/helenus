import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileForm } from './ProfileForm'
import { draftFromProfile, emptyDraft } from '../lib/profileDraft'
import { apiProfile } from '../test/api'

describe('ProfileForm', () => {
  it('disables TLS fields until TLS is on and reports edits as patches', async () => {
    const onChange = vi.fn()
    render(<ProfileForm draft={emptyDraft()} onChange={onChange} onPickBundle={() => {}} />)
    expect(screen.getByLabelText('CA certificate')).toBeDisabled()
    await userEvent.click(screen.getByRole('switch', { name: /Encrypt connections/ }))
    expect(onChange).toHaveBeenCalledWith({ tlsEnabled: true })
    await userEvent.type(screen.getByLabelText('Contact points'), 'x')
    expect(onChange).toHaveBeenLastCalledWith({ hosts: '127.0.0.1x' })
  })
  it('shows the Astra fields in Astra mode and a token that is saved', () => {
    const draft = draftFromProfile(apiProfile({ astra: { secure_bundle: '/b.zip' }, token_set: true }))
    render(<ProfileForm draft={draft} onChange={() => {}} onPickBundle={() => {}} uploadError="too big" />)
    expect(screen.getByLabelText('Secure connect bundle')).toHaveValue('/b.zip')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('too big')
    expect(screen.queryByLabelText('Contact points')).not.toBeInTheDocument()
  })
})
