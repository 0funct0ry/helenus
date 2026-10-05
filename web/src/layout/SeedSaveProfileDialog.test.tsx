import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SeedSaveProfileDialog } from './SeedSaveProfileDialog'
import { mockApi, renderWithClient as render } from '../test/api'
import { seedConfig } from '../test/seedFixture'

function setup(handler: unknown) {
  const calls = mockApi({ 'POST /p/local/seed/profiles': handler })
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(<SeedSaveProfileDialog profile="local" keyspace="shop" table="users" config={seedConfig} onSaved={onSaved} onClose={onClose} />)
  return { calls, onSaved, onClose }
}

describe('SeedSaveProfileDialog', () => {
  it('saves under the typed name', async () => {
    const { calls, onSaved, onClose } = setup({ status: 201, body: { id: 1, name: 'big' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Recipe name'), 'big')
    await userEvent.click(save)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalledWith('big')
    expect(calls[0].body).toMatchObject({ keyspace: 'shop', table: 'users', name: 'big', overwrite: false })
  })
  it('asks before overwriting an existing recipe', async () => {
    let n = 0
    const { calls, onClose } = setup(() => (n++ === 0 ? { status: 409, body: { error: { code: 'seed_profile_exists', message: 'exists' } } } : { status: 201, body: { id: 1 } }))
    await userEvent.type(screen.getByLabelText('Recipe name'), 'big')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.map((c) => (c.body as { overwrite: boolean }).overwrite)).toEqual([false, true])
  })
  it('shows other failures', async () => {
    setup({ status: 500, body: { error: { code: 'store_failed', message: 'disk full' } } })
    await userEvent.type(screen.getByLabelText('Recipe name'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
  })
})
