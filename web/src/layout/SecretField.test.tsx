import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SecretField } from './SecretField'

function Harness({ isSet = true, source }: { isSet?: boolean; source?: string }) {
  const [value, setValue] = useState('')
  const [cleared, setCleared] = useState(false)
  return <SecretField label="Password" value={value} onChange={setValue} isSet={isSet} source={source} cleared={cleared} onClear={setCleared} />
}

describe('SecretField', () => {
  it('shows a stored secret as saved, without an input', () => {
    render(<Harness />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(document.querySelector('input')).toBeNull()
  })
  it('lets the user replace the secret and cancel', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.type(input, 'new')
    expect(input).toHaveValue('new')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
  it('marks the secret for removal and can undo', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByPlaceholderText('Will be removed on save')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
  it('does not offer to change a secret that comes from a command', () => {
    render(<Harness source="password command" />)
    expect(screen.getByText('Set from password command')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
  })
  it('shows an empty input when no secret is stored', () => {
    render(<Harness isSet={false} />)
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
})
