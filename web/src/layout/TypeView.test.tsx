import { screen } from '@testing-library/react'
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
  it('handles unknown types', async () => {
    render(<TypeView tab={{ ...typeTab, object: 'nope' }} />)
    expect(await screen.findByText('Type not found.')).toBeInTheDocument()
  })
})
