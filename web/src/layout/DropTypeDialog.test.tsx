import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropTypeDialog } from './DropTypeDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'

describe('DropTypeDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('lists dependents and cannot drop while the type is in use', async () => {
    mockSchemaApi({ 'POST /p/local/types/preview': { statement: '', errors: ['in use'], notes: [], dependents: ['merchants.hq'] } })
    render(<DropTypeDialog keyspace="payments" type="address" onDropped={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('merchants.hq')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop type' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('requires typing the name, then drops', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/types/preview': { statement: 'DROP TYPE payments.geo;', errors: [], notes: [], dependents: [] } })
    const onDropped = vi.fn()
    render(<DropTypeDialog keyspace="payments" type="geo" onDropped={onDropped} onClose={() => {}} />)
    expect(await screen.findByText('DROP TYPE payments.geo;')).toBeInTheDocument()
    const drop = screen.getByRole('button', { name: 'Drop type' })
    expect(drop).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'ge')
    expect(drop).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'o')
    await userEvent.click(drop)
    await waitFor(() => expect(onDropped).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/p/local/query')?.body).toMatchObject({ cql: 'DROP TYPE payments.geo;' })
  })
})
