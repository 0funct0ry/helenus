import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileListPane } from './ProfileListPane'
import { apiProfile } from '../test/api'

describe('ProfileListPane', () => {
  it('lists profiles, marks the selection and reports clicks', async () => {
    const onSelect = vi.fn()
    const onNew = vi.fn()
    render(
      <ProfileListPane
        profiles={[apiProfile({ name: 'a' }), apiProfile({ name: 'b', astra: { secure_bundle: '/x.zip' } })]}
        selected="a"
        connections={{ b: { status: 'error', error: 'x' } }}
        onSelect={onSelect}
        onNew={onNew}
      />,
    )
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Astra DB bundle')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'error' })).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('option')[1])
    expect(onSelect).toHaveBeenCalledWith('b')
    await userEvent.click(screen.getByRole('button', { name: 'New profile' }))
    expect(onNew).toHaveBeenCalled()
  })
})
