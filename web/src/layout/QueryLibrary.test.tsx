import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryLibrary } from './QueryLibrary'
import { renderWithClient as render, mockApi } from '../test/api'
import { boundWorkspace, savedRow, toastMessages } from '../test/queriesFixture'
import { useQueryDialogs } from '../store/queryDialogs'
import { useWorkspace } from '../store/workspace'

const rows = [
  savedRow({ id: 1, name: 'reports/daily' }),
  savedRow({ id: 2, name: 'reports/weekly', global: true }),
  savedRow({ id: 3, name: 'scratch' }),
  savedRow({ id: 4, name: 'ops/health/disk' }),
]
const listApi = (extra: Record<string, unknown> = {}) => mockApi({ 'GET /p/local/queries': { queries: rows }, ...extra })
const item = (n: string) => screen.getByRole('treeitem', { name: new RegExp(n) })

describe('QueryLibrary', () => {
  beforeEach(() => boundWorkspace([]))

  it('shows the empty state', async () => {
    mockApi({ 'GET /p/local/queries': { queries: [] } })
    render(<QueryLibrary />)
    expect(await screen.findByText('No saved queries yet. Press ⌘S in a query tab to save one.')).toBeInTheDocument()
  })
  it('shows an error', async () => {
    mockApi({})
    render(<QueryLibrary />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
  it('renders folders first, then queries, sorted, with a Global badge', async () => {
    listApi()
    render(<QueryLibrary />)
    await screen.findByText('scratch')
    const top = screen.getAllByRole('treeitem').map((t) => t.textContent)
    expect(top).toEqual(['ops', 'health', 'disk', 'reports', 'daily', 'weekGlobal'.replace('weekGlobal', 'weeklyGlobal'), 'scratch'])
    expect(within(item('weekly')).getByText('Global')).toBeInTheDocument()
    expect(within(item('daily')).queryByText('Global')).not.toBeInTheDocument()
  })
  it('collapses and expands folders', async () => {
    listApi()
    render(<QueryLibrary />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'reports' }))
    expect(screen.queryByText('daily')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('treeitem', { name: 'reports' }))
    expect(screen.getByText('daily')).toBeInTheDocument()
  })
  it('filters by case-insensitive substring of the full name and expands matching folders', async () => {
    listApi()
    render(<QueryLibrary />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'reports' }))
    await userEvent.type(screen.getByLabelText('Filter saved queries'), 'REPORTS/we')
    expect(screen.getByText('weekly')).toBeInTheDocument()
    expect(screen.queryByText('daily')).not.toBeInTheDocument()
    expect(screen.queryByText('scratch')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Filter saved queries'))
    await userEvent.type(screen.getByLabelText('Filter saved queries'), 'nothing')
    expect(screen.getByText('No saved queries match “nothing”.')).toBeInTheDocument()
  })
  it('opens a query on click into a bound tab', async () => {
    listApi({ 'GET /p/local/queries/3': savedRow({ id: 3, name: 'scratch', text: 'SELECT 3;', version: 2 }) })
    render(<QueryLibrary />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'scratch' }))
    await waitFor(() => expect(useWorkspace.getState().tabs[0]).toMatchObject({ title: 'scratch.cql', savedQueryId: 3 }))
  })
  it('activates the tab already bound to the query', async () => {
    boundWorkspace()
    useWorkspace.getState().newQuery()
    listApi()
    render(<QueryLibrary />)
    await userEvent.click(await screen.findByRole('treeitem', { name: /daily/ }))
    expect(useWorkspace.getState().activeId).toBe('query-1')
    expect(useWorkspace.getState().tabs).toHaveLength(2)
  })

  describe('menu', () => {
    it('opens on right-click with the specified items', async () => {
      listApi()
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('scratch'))
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Rename / Move…', 'Duplicate', 'Copy name', 'Download .cql', 'Delete…'])
    })
    it('opens from the hover ⋯ button and with Shift+F10', async () => {
      listApi()
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      await userEvent.click(screen.getByRole('button', { name: 'Actions for scratch' }))
      expect(screen.getByRole('menu', { name: 'Actions for scratch' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      item('daily').focus()
      await userEvent.keyboard('{Shift>}{F10}{/Shift}')
      expect(screen.getByRole('menu', { name: 'Actions for reports/daily' })).toBeInTheDocument()
    })
    it('Open in new tab opens a second bound tab', async () => {
      boundWorkspace()
      listApi({ 'GET /p/local/queries/1': savedRow({ text: 'SELECT 1;' }) })
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('daily'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Open in new tab' }))
      await waitFor(() => expect(useWorkspace.getState().tabs).toHaveLength(2))
    })
    it('Rename / Move… opens the rename dialog state', async () => {
      listApi()
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('scratch'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename / Move…' }))
      expect(useQueryDialogs.getState().rename).toMatchObject({ id: 3, name: 'scratch' })
    })
    it('Duplicate posts and toasts the new name', async () => {
      const calls = listApi({ 'POST /p/local/queries/3/duplicate': { status: 201, body: savedRow({ id: 9, name: 'scratch copy' }) } })
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('scratch'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
      await waitFor(() => expect(toastMessages()).toEqual(['Duplicated as scratch copy']))
      expect(calls.filter((c) => c.path === '/p/local/queries').length).toBeGreaterThan(1)
    })
    it('Copy name writes the full name to the clipboard', async () => {
      listApi()
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('daily'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Copy name' }))
      expect(writeText).toHaveBeenCalledWith('reports/daily')
    })
    it('Download .cql fetches the text and downloads <last segment>.cql', async () => {
      listApi({ 'GET /p/local/queries/1': savedRow({ text: 'SELECT 1;' }) })
      URL.createObjectURL = vi.fn(() => 'blob:q')
      URL.revokeObjectURL = vi.fn()
      let name = ''
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        name = this.download
      })
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('daily'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Download .cql' }))
      await waitFor(() => expect(name).toBe('daily.cql'))
      click.mockRestore()
    })
    it('Delete… confirms, deletes and unbinds tabs with a toast', async () => {
      boundWorkspace()
      const calls = listApi({ 'DELETE /p/local/queries/1': { status: 204 } })
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('daily'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete saved query?' })).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(toastMessages()).toEqual(['daily.cql was deleted from the library; the tab is now unsaved']))
      expect(useWorkspace.getState().tabs[0].savedQueryId).toBeUndefined()
      expect(useWorkspace.getState().queryStates['query-1'].text).toBe('SELECT 1;')
    })
    it('Delete… can be cancelled', async () => {
      const calls = listApi()
      render(<QueryLibrary />)
      await screen.findByText('scratch')
      fireEvent.contextMenu(item('scratch'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete saved query?' })).getByRole('button', { name: 'Cancel' }))
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
