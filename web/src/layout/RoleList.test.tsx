import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleList } from './RoleList'
import { rolesData } from '../test/rolesFixture'

describe('RoleList', () => {
  it('shows badges and selects a role', async () => {
    const onSelect = vi.fn()
    render(<RoleList roles={rolesData.roles} selected="analyst" onSelect={onSelect} />)
    expect(screen.getByText('superuser')).toBeInTheDocument()
    expect(screen.getByText('in reader')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^reader$/ }))
    expect(onSelect).toHaveBeenCalledWith('reader')
  })
})
