import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { useWorkspace } from './store/workspace'
import { renderWithClient as render } from './test/api'
import { connectedWorkspace, mockSchemaApi, queryTab, tableTab, typeTab } from './test/schemaFixture'

describe('App', () => {
  beforeEach(() => {
    connectedWorkspace([tableTab, queryTab, typeTab])
    mockSchemaApi({ 'GET /profiles': { profiles: [] } })
  })

  it('renders the shell regions', async () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Schema' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Results' })).toBeInTheDocument()
  })
  it('switches tabs and closes them', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: 'query-1.cql' }))
    expect(screen.getByRole('region', { name: 'Query output' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close query-1.cql' }))
    expect(screen.queryByRole('tab', { name: 'query-1.cql' })).not.toBeInTheDocument()
  })
  it('opens the command palette with Ctrl-K', async () => {
    render(<App />)
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })
  it('has no native select elements', () => {
    const { container } = render(<App />)
    expect(container.querySelector('select, dialog')).toBeNull()
  })
  it('closes tabs from the tab menu and confirms discarding staged edits', async () => {
    render(<App />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'query-1.cql' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the left' }))
    expect(screen.queryByRole('tab', { name: tableTab.title })).not.toBeInTheDocument()
    useWorkspace.setState({ edits: { [typeTab.id]: [{ id: 'x' } as never] } })
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'query-1.cql' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))
    expect(screen.getByRole('dialog', { name: 'Discard unapplied changes?' })).toHaveTextContent(typeTab.title)
    await userEvent.click(screen.getByRole('button', { name: 'Discard and close' }))
    expect(within(screen.getByRole('tablist', { name: 'Open tabs' })).queryAllByRole('tab')).toHaveLength(0)
    expect(useWorkspace.getState()).toMatchObject({ tabs: [], activeId: '', edits: {} })
  })
})
