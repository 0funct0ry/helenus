import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionMatrix } from './PermissionMatrix'
import { rolesData } from '../test/rolesFixture'

const ks = { kind: 'keyspace', keyspace: 'shop' }

describe('PermissionMatrix', () => {
  it('offers only applicable permissions', () => {
    render(<PermissionMatrix resources={[{ kind: 'table', keyspace: 'shop', name: 'orders' }]} applicable={rolesData.applicable} granted={new Set()} pending={new Set()} onToggle={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'SELECT on TABLE shop.orders' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /EXECUTE on TABLE/ })).not.toBeInTheDocument()
  })
  it('flips granted state by pending and reports toggles', async () => {
    const onToggle = vi.fn()
    render(<PermissionMatrix resources={[ks]} applicable={rolesData.applicable} granted={new Set(['keyspace|shop|||SELECT'])} pending={new Set()} onToggle={onToggle} />)
    const box = screen.getByRole('checkbox', { name: 'SELECT on KEYSPACE shop' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(onToggle).toHaveBeenCalledWith(ks, 'SELECT', false)
  })
  it('disables cells', () => {
    render(<PermissionMatrix resources={[ks]} applicable={rolesData.applicable} granted={new Set()} pending={new Set()} disabled onToggle={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'SELECT on KEYSPACE shop' })).toBeDisabled()
  })
})
