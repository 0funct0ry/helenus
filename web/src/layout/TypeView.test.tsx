import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypeView } from './TypeView'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi, typeTab } from '../test/schemaFixture'

describe('TypeView', () => {
  beforeEach(() => {
    connectedWorkspace([typeTab])
    mockSchemaApi()
  })
  it('lists fields and usages, shows server DDL and blocks drop when in use', async () => {
    render(<TypeView tab={typeTab} />)
    expect(await screen.findByText('postal_code')).toBeInTheDocument()
    expect(screen.getByText('merchants.hq')).toBeInTheDocument()
    expect(await screen.findByText(/CREATE TYPE payments.address/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Drop type/ })).toBeDisabled()
  })
  it('opens the add-field and rename dialogs', async () => {
    render(<TypeView tab={typeTab} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add field' }))
    expect(screen.getByRole('dialog', { name: 'Add field' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Rename field postal_code' }))
    expect(screen.getByRole('dialog', { name: 'Rename field' })).toBeInTheDocument()
  })
  it('handles unknown types', async () => {
    render(<TypeView tab={{ ...typeTab, object: 'nope' }} />)
    expect(await screen.findByText('Type not found.')).toBeInTheDocument()
  })
})
