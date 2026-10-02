import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryView } from './QueryView'
import { renderWithClient as render, mockApi } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, queryTab, rowsResponse, snapshot } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

const stmt = (text: string, start: number) => ({ text, start, end: start + text.length, line: 1, complete: true })

function tabWith(cql: string, over: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return { ...queryTab, initialCql: cql, ...over }
}

/** Mock schema + split + query; `query` answers each POST /query. */
function api(split: ReturnType<typeof stmt>[], query: (call: Call) => { status?: number; body?: unknown }): Call[] {
  return mockApi({
    'GET /p/local/schema': snapshot,
    'POST /p/local/split': { statements: split },
    'POST /p/local/query': query,
  })
}

const queryCalls = (calls: Call[]) => calls.filter((c) => c.path === '/p/local/query').map((c) => c.body as Record<string, unknown>)

describe('QueryView', () => {
  beforeEach(() => connectedWorkspace([queryTab]))

  it('renders toolbar, editor and results panel', () => {
    render(<QueryView tab={tabWith('SELECT 1;')} />)
    expect(screen.getByRole('button', { name: /^Run\s*⌘/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run all/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'CQL editor' })).toHaveTextContent('SELECT 1;')
    expect(screen.getByRole('region', { name: 'Query output' })).toBeInTheDocument()
  })
  it('toggles Allow filtering and Trace into tab state', async () => {
    render(<QueryView tab={tabWith('SELECT 1;')} />)
    const af = screen.getByRole('switch', { name: 'Allow filtering' })
    expect(af).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(af)
    expect(af).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('switch', { name: 'Trace' }))
    expect(useWorkspace.getState().queryStates['query-1']).toMatchObject({ allowFiltering: true, trace: true })
  })
  it('runs the statement under the cursor and shows rows', async () => {
    const cql = 'SELECT status, amount FROM payments.merchants;'
    const calls = api([stmt(cql, 0)], () => ({ body: rowsResponse() }))
    render(<QueryView tab={tabWith(cql)} />)
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    expect(await screen.findByText('SETTLED')).toBeInTheDocument()
    expect(queryCalls(calls)[0]).toMatchObject({ cql, consistency: 'LOCAL_QUORUM', page_size: 100, page_state: null, allow_filtering: false, serial_consistency: '' })
  })
  it('sends the chosen settings', async () => {
    const cql = 'SELECT 1 FROM payments.merchants;'
    const calls = api([stmt(cql, 0)], () => ({ body: rowsResponse() }))
    render(<QueryView tab={tabWith(cql)} />)
    await userEvent.click(screen.getByRole('button', { name: /Consistency/ }))
    await userEvent.click(screen.getByRole('option', { name: 'QUORUM' }))
    await userEvent.click(screen.getByRole('button', { name: /Page size/ }))
    await userEvent.click(screen.getByRole('option', { name: '500' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Trace' }))
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    await screen.findByText('SETTLED')
    expect(queryCalls(calls)[0]).toMatchObject({ consistency: 'QUORUM', page_size: 500, trace: true })
    useWorkspace.getState().setConsistency('LOCAL_QUORUM')
  })
  it('disables ANY for reads with an explanation', async () => {
    render(<QueryView tab={tabWith('SELECT * FROM payments.merchants;')} />)
    await userEvent.click(screen.getByRole('button', { name: /Consistency/ }))
    const any = screen.getByRole('option', { name: 'ANY' })
    expect(any).toHaveAttribute('aria-disabled', 'true')
    expect(any).toHaveAttribute('title', expect.stringMatching(/only valid for writes/))
  })
  it('shows the serial selector only for statements with IF', async () => {
    const { unmount } = render(<QueryView tab={tabWith('INSERT INTO payments.merchants (merchant_id) VALUES (uuid()) IF NOT EXISTS;')} />)
    expect(screen.getByRole('button', { name: /Serial/ })).toBeInTheDocument()
    unmount()
    useWorkspace.setState({ queryStates: {} })
    render(<QueryView tab={tabWith('SELECT 1;')} />)
    expect(screen.queryByRole('button', { name: /Serial/ })).not.toBeInTheDocument()
  })
  it('runs all statements as one tab each and stops at the first error', async () => {
    const a = 'SELECT 1 FROM payments.merchants;'
    const b = 'SELECT 2 FROM payments.nope;'
    const c = 'SELECT 3 FROM payments.merchants;'
    const text = `${a}\n${b}\n${c}`
    const calls = api([stmt(a, 0), stmt(b, a.length + 1), stmt(c, a.length + b.length + 2)], (call) =>
      (call.body as { cql: string }).cql === b ? { status: 502, body: { error: { code: 'query_failed', message: 'unconfigured table nope' } } } : { body: rowsResponse() },
    )
    render(<QueryView tab={tabWith(text)} />)
    await userEvent.click(screen.getByRole('button', { name: /Run all/ }))
    expect(await screen.findByRole('tab', { name: /Statement 2/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unconfigured table nope'))
    expect(queryCalls(calls)).toHaveLength(2)
    expect(screen.queryByRole('tab', { name: /Statement 3/ })).not.toBeInTheDocument()
  })
  it('pages with the page-state stack', async () => {
    const cql = 'SELECT * FROM payments.merchants;'
    const calls = api([stmt(cql, 0)], (call) => {
      const ps = (call.body as { page_state: string | null }).page_state
      return { body: rowsResponse(ps === null ? { has_more: true, page_state: 'P2' } : { rows: [['ON PAGE 2', '1']] }) }
    })
    render(<QueryView tab={tabWith(cql)} />)
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('ON PAGE 2')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('SETTLED')).toBeInTheDocument()
    expect(queryCalls(calls).map((b) => b.page_state)).toEqual([null, 'P2', null])
  })
  it('re-runs with ALLOW FILTERING after a filtering error, one-shot', async () => {
    const cql = 'SELECT * FROM payments.merchants WHERE name = \'x\';'
    const calls = api([stmt(cql, 0)], (call) =>
      (call.body as { allow_filtering: boolean }).allow_filtering
        ? { body: rowsResponse() }
        : { status: 422, body: { error: { code: 'filtering_required', message: 'needs filtering', detail: { executed_cql: cql } } } },
    )
    render(<QueryView tab={tabWith(cql)} />)
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run with ALLOW FILTERING' }))
    expect(await screen.findByText('SETTLED')).toBeInTheDocument()
    expect(queryCalls(calls).map((b) => b.allow_filtering)).toEqual([false, true])
    expect(screen.getByRole('switch', { name: 'Allow filtering' })).toHaveAttribute('aria-checked', 'false')
  })
  it('refreshes the schema and updates the keyspace after a schema change / USE', async () => {
    const cql = 'USE inventory;'
    const calls = api([stmt(cql, 0)], () => ({ body: rowsResponse({ kind: 'schema_change', columns: [], rows: [], keyspace_after: 'inventory' }) }))
    render(<QueryView tab={tabWith(cql)} />)
    await screen.findByRole('button', { name: /Keyspace/ })
    const before = calls.filter((c) => c.path === '/p/local/schema').length
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    expect(await screen.findByText(/Schema change applied/)).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((c) => c.path === '/p/local/schema').length).toBeGreaterThan(before))
    expect(screen.getByRole('button', { name: 'Keyspace: inventory' })).toBeInTheDocument()
  })
  it('cancels a running statement', async () => {
    const cql = 'SELECT * FROM payments.merchants;'
    mockApi({ 'GET /p/local/schema': snapshot, 'POST /p/local/split': { statements: [stmt(cql, 0)] } })
    const base = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/query')) {
        return new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
      }
      return base(input, init)
    }) as typeof fetch
    render(<QueryView tab={tabWith(cql)} />)
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Cancelled.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
  it('counts rows through SELECT COUNT(*) after confirmation', async () => {
    const cql = 'SELECT * FROM payments.merchants LIMIT 10;'
    const calls = api([stmt(cql, 0)], (call) =>
      /COUNT/.test((call.body as { cql: string }).cql) ? { body: rowsResponse({ columns: [{ name: 'count', type: { name: 'bigint' } }], rows: [['42']] }) } : { body: rowsResponse({ executed_cql: cql }) },
    )
    render(<QueryView tab={tabWith(cql)} />)
    await userEvent.click(screen.getByRole('button', { name: /^Run\s*⌘/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Count rows' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Count rows' }).at(-1)!)
    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(queryCalls(calls).at(-1)?.cql).toBe('SELECT COUNT(*) FROM payments.merchants;')
  })
})
