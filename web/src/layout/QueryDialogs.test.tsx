import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryDialogs } from './QueryDialogs'
import { renderWithClient as render, mockApi } from '../test/api'
import { boundWorkspace, savedRow, toastMessages } from '../test/queriesFixture'
import { useQueryDialogs } from '../store/queryDialogs'
import { useWorkspace } from '../store/workspace'

const dirty = () => useWorkspace.getState().patchQuery('query-1', { text: 'SELECT 2;' })

describe('QueryDialogs', () => {
  beforeEach(() => boundWorkspace())

  it('renders nothing by default', () => {
    render(<QueryDialogs />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  describe('Save as', () => {
    it('saves the tab text, binds the tab and titles it from the last segment', async () => {
      useWorkspace.setState({ tabs: [{ ...useWorkspace.getState().tabs[0], savedQueryId: undefined, queryName: undefined, title: 'query-1.cql' }] })
      dirty()
      const row = savedRow({ id: 5, name: 'reports/weekly', version: 1 })
      const calls = mockApi({ 'GET /p/local/queries': { queries: [] }, 'POST /p/local/queries': { status: 201, body: row } })
      render(<QueryDialogs />)
      act(() => useQueryDialogs.getState().set({ saveAs: { tabId: 'query-1', name: '' } }))
      await userEvent.type(screen.getByLabelText('Name'), 'reports/weekly')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(useWorkspace.getState().tabs[0]).toMatchObject({ title: 'weekly.cql', savedQueryId: 5, queryName: 'reports/weekly' }))
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'reports/weekly', text: 'SELECT 2;', global: false })
      expect(useWorkspace.getState().queryStates['query-1']).toMatchObject({ savedText: 'SELECT 2;', savedVersion: 1 })
      expect(toastMessages()).toEqual(['Saved weekly.cql'])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    it('closes the tab afterwards when requested', async () => {
      mockApi({ 'GET /p/local/queries': { queries: [] }, 'POST /p/local/queries': { status: 201, body: savedRow({ id: 5, name: 'x' }) } })
      render(<QueryDialogs />)
      act(() => useQueryDialogs.getState().set({ saveAs: { tabId: 'query-1', name: 'x', closeAfter: true } }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(useWorkspace.getState().tabs).toHaveLength(0))
    })
  })

  describe('Rename / Move', () => {
    it('renames bound tabs', async () => {
      mockApi({
        'GET /p/local/queries': { queries: [] },
        'GET /p/local/queries/1': savedRow({ text: 'SELECT 1;' }),
        'PUT /p/local/queries/1': savedRow({ name: 'moved/daily2', version: 2, text: 'SELECT 1;' }),
      })
      render(<QueryDialogs />)
      act(() => useQueryDialogs.getState().set({ rename: savedRow() }))
      const n = screen.getByLabelText('Name')
      await userEvent.clear(n)
      await userEvent.type(n, 'moved/daily2')
      await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
      await waitFor(() => expect(useWorkspace.getState().tabs[0]).toMatchObject({ title: 'daily2.cql', queryName: 'moved/daily2' }))
      expect(useWorkspace.getState().queryStates['query-1'].savedVersion).toBe(2)
      expect(useQueryDialogs.getState().rename).toBeNull()
    })
  })

  describe('unsaved changes', () => {
    beforeEach(() => {
      dirty()
      useQueryDialogs.getState().set({ unsaved: 'query-1' })
    })
    it('asks about the tab by title', () => {
      render(<QueryDialogs />)
      expect(screen.getByRole('dialog', { name: 'Save changes to daily.cql?' })).toBeInTheDocument()
    })
    it('Cancel keeps the tab', async () => {
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(useWorkspace.getState().tabs).toHaveLength(1)
      expect(useQueryDialogs.getState().unsaved).toBeNull()
    })
    it('Don’t save closes without calling the API', async () => {
      const calls = mockApi({})
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Don’t save' }))
      expect(useWorkspace.getState().tabs).toHaveLength(0)
      expect(calls).toHaveLength(0)
    })
    it('Save writes the query and closes the tab', async () => {
      const calls = mockApi({ 'PUT /p/local/queries/1': savedRow({ version: 2 }) })
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(useWorkspace.getState().tabs).toHaveLength(0))
      expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ text: 'SELECT 2;', version: 1 })
    })
    it('Save keeps the tab open when the save conflicts, then shows the conflict dialog', async () => {
      mockApi({ 'PUT /p/local/queries/1': { status: 409, body: { error: { code: 'query_conflict', message: 'c', detail: savedRow({ version: 4, text: 'theirs' }) } } } })
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('dialog', { name: 'This query was changed elsewhere' })).toBeInTheDocument()
      expect(useWorkspace.getState().tabs).toHaveLength(1)
    })
  })

  describe('conflict', () => {
    const current = savedRow({ version: 4, text: 'theirs' })
    beforeEach(() => {
      dirty()
      useQueryDialogs.getState().set({ conflict: { tabId: 'query-1', current } })
    })
    it('Overwrite re-saves with the newer version', async () => {
      const calls = mockApi({ 'PUT /p/local/queries/1': savedRow({ version: 5 }) })
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
      await waitFor(() => expect(useWorkspace.getState().queryStates['query-1'].savedVersion).toBe(5))
      expect(calls[0].body).toMatchObject({ text: 'SELECT 2;', version: 4 })
      expect(useQueryDialogs.getState().conflict).toBeNull()
    })
    it('Save as copy opens Save as with "<name> copy"', async () => {
      mockApi({ 'GET /p/local/queries': { queries: [] } })
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Save as copy' }))
      expect(useQueryDialogs.getState().saveAs).toMatchObject({ tabId: 'query-1', name: 'reports/daily copy' })
      expect((await screen.findByLabelText('Name')) as HTMLInputElement).toHaveValue('reports/daily copy')
    })
    it('Reload replaces the text after the confirm and remounts the editor', async () => {
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
      expect(useWorkspace.getState().queryStates['query-1'].text).toBe('SELECT 2;')
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Reload the saved text?' })).getByRole('button', { name: 'Reload' }))
      expect(useWorkspace.getState().queryStates['query-1']).toMatchObject({ text: 'theirs', savedText: 'theirs', savedVersion: 4 })
      expect(useWorkspace.getState().editorEpochs['query-1']).toBe(1)
    })
    it('Reload fetches the text when the conflict row has none', async () => {
      useQueryDialogs.getState().set({ conflict: { tabId: 'query-1', current: savedRow({ version: 4 }) } })
      mockApi({ 'GET /p/local/queries/1': savedRow({ version: 4, text: 'fetched' }) })
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Reload the saved text?' })).getByRole('button', { name: 'Reload' }))
      await waitFor(() => expect(useWorkspace.getState().queryStates['query-1'].text).toBe('fetched'))
    })
    it('Cancel changes nothing', async () => {
      render(<QueryDialogs />)
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(useWorkspace.getState().queryStates['query-1']).toMatchObject({ text: 'SELECT 2;', savedVersion: 1 })
      expect(useQueryDialogs.getState().conflict).toBeNull()
    })
  })

  describe('file picker', () => {
    it('limits the picker and opens each chosen file in an unbound tab', async () => {
      render(<QueryDialogs />)
      const input = screen.getByTestId('cql-file-input') as HTMLInputElement
      expect(input).toHaveAttribute('accept', '.cql,.txt,.sql')
      const click = vi.spyOn(input, 'click')
      act(() => useQueryDialogs.getState().pickFile())
      expect(click).toHaveBeenCalled()
      fireEvent.change(input, { target: { files: [new File(['SELECT 7;'], 'a.cql')] } })
      await waitFor(() => expect(useWorkspace.getState().tabs).toHaveLength(2))
      expect(useWorkspace.getState().tabs[1]).toMatchObject({ title: 'a.cql' })
    })
  })
})
