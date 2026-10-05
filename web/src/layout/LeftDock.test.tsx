import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeftDock } from './LeftDock'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'

describe('LeftDock', () => {
  beforeEach(() => connectedWorkspace([]))
  it('switches between the schema tree and the schema changes panel', async () => {
    mockSchemaApi({ 'GET /p/local/schema-changes?limit=50': { items: [], next_before: null } })
    render(<LeftDock />)
    expect(screen.getByRole('tab', { name: /Schema$/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('Search schema changes')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Schema changes/ }))
    expect(await screen.findByLabelText('Search schema changes')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Schema changes/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: /Schema$/ }))
    expect(screen.queryByLabelText('Search schema changes')).not.toBeInTheDocument()
  })
})
