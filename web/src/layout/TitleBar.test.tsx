import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient as render, mockApi, apiProfile } from '../test/api'
import { TitleBar } from './TitleBar'
import { useWorkspace } from '../store/workspace'
import { tableTab } from '../test/schemaFixture'

describe('TitleBar', () => {
  it('shows mark, profile, breadcrumb and theme toggle', async () => {
    mockApi({ 'GET /profiles': { profiles: [apiProfile({ name: 'prod-eu' })] } })
    useWorkspace.setState({ profileId: 'prod-eu', tabs: [tableTab], activeId: tableTab.id })
    render(<TitleBar />)
    expect(screen.getByText('helenus')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /prod-eu/ })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('payments')
    expect(screen.getByRole('button', { name: /Theme:/ })).toBeInTheDocument()
  })
  it('opens the command palette', async () => {
    render(<TitleBar />)
    await userEvent.click(screen.getByRole('button', { name: /Search or run a command/ }))
    expect(useWorkspace.getState().paletteOpen).toBe(true)
  })
})
