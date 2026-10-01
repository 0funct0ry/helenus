import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSwitcher } from './ProfileSwitcher'
import { useWorkspace } from '../store/workspace'

describe('ProfileSwitcher', () => {
  it('lists profiles with statuses and switches', async () => {
    render(<ProfileSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: /prod-eu/ }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.getAllByRole('img', { name: 'error' }).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('menuitemradio', { name: /local/ }))
    expect(useWorkspace.getState().profileId).toBe('local')
  })
  it('opens the profile dialog', async () => {
    render(<ProfileSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: /local|prod-eu/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Manage profiles/ }))
    expect(useWorkspace.getState().profileDialogOpen).toBe(true)
  })
})
