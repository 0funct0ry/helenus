import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileDialog } from './ProfileDialog'
import { useWorkspace } from '../store/workspace'

describe('ProfileDialog', () => {
  it('renders nothing when closed', () => {
    useWorkspace.setState({ profileDialogOpen: false })
    render(<ProfileDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shows profiles and the form', async () => {
    useWorkspace.setState({ profileDialogOpen: true, profileId: 'prod-eu' })
    render(<ProfileDialog />)
    expect(screen.getByRole('dialog', { name: 'Connection profiles' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByLabelText('Profile name')).toHaveValue('prod-eu')
    expect(screen.getByLabelText('Contact points')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /astra-dev/ }))
    expect(screen.getByLabelText('Profile name')).toHaveValue('astra-dev')
    expect(screen.getByText(/expired/)).toBeInTheDocument()
  })
  it('switches to the Astra tab and closes on Save', async () => {
    useWorkspace.setState({ profileDialogOpen: true })
    render(<ProfileDialog />)
    await userEvent.click(screen.getByRole('tab', { name: 'Astra DB' }))
    expect(screen.getByLabelText('Secure connect bundle')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(useWorkspace.getState().profileDialogOpen).toBe(false)
  })
})
