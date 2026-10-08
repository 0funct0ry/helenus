import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { useWorkspace } from './store/workspace'
import { renderWithClient as render } from './test/api'
import { boundTab, boundWorkspace, savedRow, toastMessages } from './test/queriesFixture'
import { mockApi } from './test/api'
import { snapshot } from './test/schemaFixture'
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

  describe('saved queries', () => {
    const open = (text = 'SELECT 1;', saved = 'SELECT 1;') => {
      boundWorkspace([boundTab], { 'query-1': { text, savedText: saved, savedVersion: 1 } })
      mockSchemaApi({ 'GET /profiles': { profiles: [] }, 'GET /p/local/queries': { queries: [] }, 'PUT /p/local/queries/1': savedRow({ version: 2 }) })
    }
    it('shows the tab with its title, tooltip and no dot while clean', () => {
      open()
      render(<App />)
      const tab = screen.getByRole('tab', { name: 'daily.cql' })
      expect(tab).toHaveAttribute('title', 'reports/daily')
      expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    })
    it('marks a global query in the tooltip', () => {
      open()
      useWorkspace.setState({ tabs: [{ ...boundTab, queryGlobal: true }] })
      render(<App />)
      expect(screen.getByRole('tab', { name: 'daily.cql' })).toHaveAttribute('title', 'reports/daily (Global)')
    })
    it('shows the Unsaved changes dot when the text differs from the saved text', () => {
      open('SELECT 2;')
      render(<App />)
      expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument()
    })
    it('never marks an unbound tab', () => {
      open()
      useWorkspace.setState({ tabs: [{ ...boundTab, savedQueryId: undefined }] })
      useWorkspace.getState().patchQuery('query-1', { text: 'changed' })
      render(<App />)
      expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    })
    it('Ctrl-S saves the active bound query tab and clears the dot', async () => {
      open('SELECT 2;')
      render(<App />)
      await userEvent.keyboard('{Control>}s{/Control}')
      await waitFor(() => expect(toastMessages()).toEqual(['Saved daily.cql']))
      expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    })
    it('Ctrl-S saves once even with the editor focused', async () => {
      open('SELECT 2;')
      const calls = mockApi({ 'GET /profiles': { profiles: [] }, 'GET /p/local/schema': snapshot, 'GET /p/local/queries': { queries: [] }, 'PUT /p/local/queries/1': savedRow({ version: 2 }) })
      render(<App />)
      screen.getByRole('textbox', { name: 'CQL editor' }).focus()
      await userEvent.keyboard('{Control>}s{/Control}')
      await waitFor(() => expect(toastMessages()).toHaveLength(1))
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    it('Shift-Ctrl-S opens Save as, prefilled with the bound name', async () => {
      open()
      render(<App />)
      await userEvent.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
      expect(await screen.findByRole('dialog', { name: 'Save query' })).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toHaveValue('reports/daily')
    })
    it('Ctrl-S on a non-query tab does nothing', async () => {
      boundWorkspace([tableTab], {})
      mockSchemaApi({ 'GET /profiles': { profiles: [] } })
      render(<App />)
      await userEvent.keyboard('{Control>}s{/Control}')
      expect(screen.queryByRole('dialog', { name: 'Save query' })).not.toBeInTheDocument()
    })
    it('closing a dirty bound tab with X asks, and Cancel keeps it', async () => {
      open('SELECT 2;')
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'Close daily.cql' }))
      expect(screen.getByRole('dialog', { name: 'Save changes to daily.cql?' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('tab', { name: 'daily.cql' })).toBeInTheDocument()
    })
    it('the Delete key asks for a dirty tab; Don’t save closes it', async () => {
      open('SELECT 2;')
      render(<App />)
      screen.getByRole('tab', { name: 'daily.cql' }).focus()
      await userEvent.keyboard('{Delete}')
      await userEvent.click(screen.getByRole('button', { name: 'Don’t save' }))
      expect(screen.queryByRole('tab', { name: 'daily.cql' })).not.toBeInTheDocument()
    })
    it('Save in the dialog saves, then closes the tab', async () => {
      open('SELECT 2;')
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'Close daily.cql' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('tab', { name: 'daily.cql' })).not.toBeInTheDocument())
    })
    it('closing a clean bound tab needs no dialog', async () => {
      open()
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'Close daily.cql' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'daily.cql' })).not.toBeInTheDocument()
    })
    it('Close all lists dirty bound tabs with "Discard and close"', async () => {
      open('SELECT 2;')
      render(<App />)
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'daily.cql' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))
      expect(screen.getByRole('dialog', { name: 'Discard unapplied changes?' })).toHaveTextContent('daily.cql')
      await userEvent.click(screen.getByRole('button', { name: 'Discard and close' }))
      expect(useWorkspace.getState().tabs).toHaveLength(0)
    })
    it('a conflict on Ctrl-S shows the conflict dialog', async () => {
      open('SELECT 2;')
      mockApi({
        'GET /profiles': { profiles: [] },
        'GET /p/local/schema': snapshot,
        'GET /p/local/queries': { queries: [] },
        'PUT /p/local/queries/1': { status: 409, body: { error: { code: 'query_conflict', message: 'x', detail: savedRow({ version: 3, text: 'theirs' }) } } },
      })
      render(<App />)
      await userEvent.keyboard('{Control>}s{/Control}')
      expect(await screen.findByRole('dialog', { name: 'This query was changed elsewhere' })).toBeInTheDocument()
    })
    it('Reload remounts the editor with the saved text', async () => {
      open('SELECT 2;')
      mockApi({
        'GET /profiles': { profiles: [] },
        'GET /p/local/schema': snapshot,
        'GET /p/local/queries': { queries: [] },
        'PUT /p/local/queries/1': { status: 409, body: { error: { code: 'query_conflict', message: 'x', detail: savedRow({ version: 3, text: 'SELECT theirs;' }) } } },
      })
      render(<App />)
      await userEvent.keyboard('{Control>}s{/Control}')
      await userEvent.click(await screen.findByRole('button', { name: 'Reload' }))
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Reload the saved text?' })).getByRole('button', { name: 'Reload' }))
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'CQL editor' })).toHaveTextContent('SELECT theirs;'))
      expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    })
  })
})
