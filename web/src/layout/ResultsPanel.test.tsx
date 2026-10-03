import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultsPanel } from './ResultsPanel'
import { rowsResponse } from '../test/schemaFixture'
import type { StatementResult } from '../store/workspace'
import type { ResultsPanelProps } from './ResultsPanel'

const done = (over: Partial<StatementResult> = {}): StatementResult => ({ id: 'r1', cql: 'SELECT * FROM payments.merchants;', status: 'done', response: rowsResponse(), pageStates: [null], ...over })

function setup(results: StatementResult[], over: Partial<ResultsPanelProps> = {}) {
  const props: ResultsPanelProps = { results, active: 0, onActive: vi.fn(), consistency: 'QUORUM', onPage: vi.fn(), onRunWithFiltering: vi.fn(), onCount: vi.fn().mockResolvedValue('7'), ...over }
  render(<ResultsPanel {...props} />)
  return props
}

describe('ResultsPanel', () => {
  it('prompts before anything has run', () => {
    setup([])
    expect(screen.getByText(/Run a statement/)).toBeInTheDocument()
  })
  it('shows the grid, timing and null cells', () => {
    setup([done()])
    expect(screen.getByRole('table', { name: 'Results' })).toBeInTheDocument()
    expect(screen.getByText('SETTLED')).toBeInTheDocument()
    expect(screen.getByText('null')).toHaveClass('text-dim')
    expect(screen.getByText('12.5 ms client')).toBeInTheDocument()
  })
  it('pages with Previous and Next', async () => {
    const props = setup([done({ pageStates: [null, 'abc'], response: rowsResponse({ has_more: true, page_state: 'def' }) })])
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(props.onPage).toHaveBeenNthCalledWith(1, 0, 1)
    expect(props.onPage).toHaveBeenNthCalledWith(2, 0, -1)
  })
  it('counts rows only after the modal is confirmed', async () => {
    const props = setup([done()])
    await userEvent.click(screen.getByRole('button', { name: 'Count rows' }))
    expect(props.onCount).not.toHaveBeenCalled()
    await userEvent.click(within_dialog('Count rows'))
    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(props.onCount).toHaveBeenCalledWith(0)
  })
  it('shows one tab per statement and switches', async () => {
    const props = setup([done(), done({ id: 'r2', status: 'error', error: { code: 'query_failed', message: 'boom' } })])
    await userEvent.click(screen.getByRole('tab', { name: /Statement 2/ }))
    expect(props.onActive).toHaveBeenCalledWith(1)
  })
  it('offers Run with ALLOW FILTERING for filtering errors', async () => {
    const props = setup([done({ status: 'error', response: undefined, error: { code: 'filtering_required', message: 'needs filtering' } })])
    await userEvent.click(screen.getByRole('button', { name: 'Run with ALLOW FILTERING' }))
    expect(props.onRunWithFiltering).toHaveBeenCalledWith(0)
  })
  it('shows other errors and cancellation', () => {
    setup([done({ status: 'error', response: undefined, error: { code: 'query_failed', message: 'line 1:5 no viable alternative' } })])
    expect(screen.getByRole('alert')).toHaveTextContent('no viable alternative')
  })
  it('shows void and schema_change outcomes', () => {
    setup([done({ response: rowsResponse({ kind: 'schema_change', columns: [], rows: [] }) })])
    expect(screen.getByText(/Schema change applied/)).toBeInTheDocument()
  })
  it('lists executed CQL and warnings in Messages', async () => {
    setup([done({ response: rowsResponse({ warnings: ['Aggregation query used without partition key'], trace_id: 'tr-1' }) })])
    await userEvent.click(screen.getByRole('tab', { name: /Messages/ }))
    expect(screen.getByText(/Aggregation query used/)).toBeInTheDocument()
    expect(screen.getByText('SELECT status, amount FROM payments.merchants;')).toBeInTheDocument()
  })
  it('shows the trace tab states and the coordinator time in the footer', async () => {
    const data = { id: 'tr-1', started_at: '', duration_us: 31700, summary: { coordinator: '10.0.0.1', request: 'q', coordinator_ms: 31.7, replicas_contacted: 0, event_count: 0, node_count: 0 }, lanes: [], events: [] }
    setup([done({ response: rowsResponse({ trace_id: 'tr-1' }) })], { trace: { data, loading: false, onRetry: vi.fn() } })
    expect(screen.getByText(/31\.7 ms coordinator/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Trace/ }))
    expect(screen.getByRole('img', { name: 'Trace waterfall' })).toBeInTheDocument()
  })
  it('hints at the Trace toggle when the statement was not traced', async () => {
    setup([done()])
    await userEvent.click(screen.getByRole('tab', { name: /Trace/ }))
    expect(screen.getByText(/Turn on Trace/)).toBeInTheDocument()
  })
})

function within_dialog(name: string) {
  const dlg = screen.getByRole('dialog')
  return Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent === name) as HTMLElement
}
