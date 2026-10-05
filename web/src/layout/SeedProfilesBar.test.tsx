import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SeedProfilesBar } from './SeedProfilesBar'
import { mockApi, renderWithClient as render } from '../test/api'
import { seedConfig } from '../test/seedFixture'

const saved = { id: 7, keyspace: 'shop', table: 'users', name: 'big', config: seedConfig, created_at: '', updated_at: '' }
const list = 'GET /p/local/seed/profiles?keyspace=shop&table=users'

describe('SeedProfilesBar', () => {
  it('loads a saved recipe', async () => {
    mockApi({ [list]: { profiles: [saved] } })
    const onLoad = vi.fn()
    render(<SeedProfilesBar profile="local" keyspace="shop" table="users" onLoad={onLoad} onSave={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Load recipe/ })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /Load recipe/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'big' }))
    expect(onLoad).toHaveBeenCalledWith(saved)
  })
  it('opens the save dialog', async () => {
    mockApi({ [list]: { profiles: [] } })
    const onSave = vi.fn()
    render(<SeedProfilesBar profile="local" keyspace="shop" table="users" onLoad={() => {}} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as recipe…' }))
    expect(onSave).toHaveBeenCalled()
  })
  it('deletes the selected recipe after confirmation', async () => {
    const calls = mockApi({ [list]: { profiles: [saved] }, 'DELETE /p/local/seed/profiles/7': { status: 204 } })
    render(<SeedProfilesBar profile="local" keyspace="shop" table="users" onLoad={() => {}} onSave={() => {}} />)
    expect(screen.getByRole('button', { name: 'Delete recipe' })).toBeDisabled()
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: /Load recipe/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'big' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })
})
