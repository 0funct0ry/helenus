import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './CommandPalette'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi, queryTab } from '../test/schemaFixture'
import { boundWorkspace, savedRow, toastMessages } from '../test/queriesFixture'
import { useQueryDialogs } from '../store/queryDialogs'
import { useWorkspace } from '../store/workspace'

describe('CommandPalette', () => {
  beforeEach(() => {
    connectedWorkspace()
    mockSchemaApi()
    useWorkspace.setState({ paletteOpen: true })
  })

  it('is hidden when closed', () => {
    useWorkspace.setState({ paletteOpen: false })
    render(<CommandPalette />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('filters actions', async () => {
    render(<CommandPalette />)
    await screen.findByText('payments.ledger_counters')
    await userEvent.type(screen.getByRole('combobox', { name: 'Command' }), 'ledger')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('payments.ledger_counters')
  })
  it('runs the highlighted action with Enter and closes', async () => {
    render(<CommandPalette />)
    await screen.findByText('payments.ledger_counters')
    await userEvent.type(screen.getByRole('combobox'), 'ledger{Enter}')
    expect(useWorkspace.getState().activeId).toBe('table:payments.ledger_counters')
    expect(useWorkspace.getState().paletteOpen).toBe(false)
  })
  it('closes on Escape', async () => {
    render(<CommandPalette />)
    await userEvent.keyboard('{Escape}')
    expect(useWorkspace.getState().paletteOpen).toBe(false)
  })
  it('shows an empty state', async () => {
    render(<CommandPalette />)
    await userEvent.type(screen.getByRole('combobox'), 'zzzzz')
    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })
})

describe('CommandPalette saved queries', () => {
  beforeEach(() => {
    boundWorkspace([{ ...queryTab, savedQueryId: undefined }], { 'query-1': { text: 'x' } })
    useWorkspace.setState({ paletteOpen: true })
  })
  const queries = { queries: [savedRow({ id: 1, name: 'reports/daily' }), savedRow({ id: 2, name: 'scratch' })] }

  it('lists saved queries by full name in their own group and opens one', async () => {
    mockSchemaApi({ 'GET /p/local/queries': queries, 'GET /p/local/queries/2': savedRow({ id: 2, name: 'scratch', text: 'SELECT 2;' }) })
    render(<CommandPalette />)
    expect(await screen.findByText('reports/daily')).toBeInTheDocument()
    expect(screen.getByText('Saved queries')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('combobox'), 'scrat{Enter}')
    await waitFor(() => expect(useWorkspace.getState().tabs.at(-1)).toMatchObject({ title: 'scratch.cql', savedQueryId: 2 }))
  })
  it('offers Save query, Save query as… and Open .cql file…', async () => {
    mockSchemaApi({ 'GET /p/local/queries': queries })
    render(<CommandPalette />)
    expect(await screen.findByRole('option', { name: 'Save query' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Save query as…' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Open .cql file…' })).toBeInTheDocument()
  })
  it('Save query as… opens the dialog for the active query tab', async () => {
    mockSchemaApi({ 'GET /p/local/queries': queries })
    render(<CommandPalette />)
    await userEvent.click(await screen.findByRole('option', { name: 'Save query as…' }))
    expect(useQueryDialogs.getState().saveAs).toMatchObject({ tabId: 'query-1' })
    expect(useWorkspace.getState().paletteOpen).toBe(false)
  })
  it('Save query saves a bound tab', async () => {
    const calls = mockSchemaApi({ 'GET /p/local/queries': queries, 'PUT /p/local/queries/1': savedRow({ version: 2 }) })
    boundWorkspace()
    useWorkspace.setState({ paletteOpen: true })
    render(<CommandPalette />)
    await userEvent.click(await screen.findByRole('option', { name: 'Save query' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
  })
  it('asks for a query tab when none is active', async () => {
    boundWorkspace([{ ...queryTab, kind: 'table' }])
    useWorkspace.setState({ paletteOpen: true })
    mockSchemaApi({ 'GET /p/local/queries': queries })
    render(<CommandPalette />)
    await userEvent.click(await screen.findByRole('option', { name: 'Save query' }))
    expect(toastMessages()).toEqual(['Open a query tab first'])
  })
  it('Open .cql file… asks for the picker', async () => {
    mockSchemaApi({ 'GET /p/local/queries': queries })
    render(<CommandPalette />)
    await userEvent.click(await screen.findByRole('option', { name: 'Open .cql file…' }))
    expect(useQueryDialogs.getState().pickerNonce).toBe(1)
  })
})
