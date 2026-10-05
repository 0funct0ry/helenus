import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddResourceDialog } from './AddResourceDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'

describe('AddResourceDialog', () => {
  beforeEach(() => {
    connectedWorkspace()
    mockSchemaApi()
  })

  it('adds a resource that needs no name', async () => {
    const onAdd = vi.fn()
    render(<AddResourceDialog kinds={['all_keyspaces', 'table']} onAdd={onAdd} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(onAdd).toHaveBeenCalledWith({ kind: 'all_keyspaces' })
  })

  it('requires a name for a role resource', () => {
    render(<AddResourceDialog kinds={['role']} onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Add resource' })).toBeDisabled()
  })
})
