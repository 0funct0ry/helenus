import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TableView } from './TableView'
import { renderWithClient as render } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, mockSchemaApi, tableTab, viewTab } from '../test/schemaFixture'
import { MERCHANT, TXN, counterResponse, txnResponse } from '../test/editFixture'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'
import type { ApplyResponse } from '../api/types'

const key = { merchant_id: MERCHANT, txn_day: '2026-09-30', txn_time: TXN }
const counterTab: WorkspaceTab = { id: 'table:payments.ledger_counters', kind: 'table', title: 'ledger_counters', keyspace: 'payments', object: 'ledger_counters', closable: true }
const systemTab: WorkspaceTab = { id: 'table:system.local', kind: 'table', title: 'local', keyspace: 'system', object: 'local', closable: true }

const applied = (n: number): ApplyResponse => ({
  results: Array.from({ length: n }, (_, index) => ({ index, status: 'applied' as const, executed_cql: '' })),
  applied: n,
  failed_at: -1,
})

function open(extra: Record<string, unknown> = {}, tab: WorkspaceTab = tableTab, rows = txnResponse()): Call[] {
  connectedWorkspace([tab])
  return mockSchemaApi({ 'POST /p/local/query': { body: rows }, ...extra })
}
const dbl = async (text: string) => userEvent.dblClick(await screen.findByText(text))
const applyCall = (calls: Call[]) => calls.find((c) => c.path === '/p/local/changes/apply')?.body as { changes: unknown[]; consistency: string; keyspace: string; table: string }

describe('TableView editing', () => {
  it('edits a cell inline, stages it in the pending bar, and applies it', async () => {
    const calls = open({ 'POST /p/local/changes/apply': { body: applied(1) } })
    render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    const box = screen.getByRole('textbox', { name: 'Edit amount' })
    await userEvent.clear(box)
    await userEvent.type(box, '1250.00{Enter}')

    expect(await screen.findByText('1 pending change')).toBeInTheDocument()
    expect(screen.getByText('1250.00')).toBeInTheDocument()
    expect(screen.getByText('1250.00').closest('[role="cell"]')).toHaveAttribute('title', 'Was 1180.00')
    expect(useWorkspace.getState().edits[tableTab.id]).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(screen.queryByText('1 pending change')).not.toBeInTheDocument())
    expect(applyCall(calls)).toEqual({
      keyspace: 'payments',
      table: 'transactions_by_merchant',
      consistency: 'LOCAL_QUORUM',
      changes: [{ kind: 'set_cell', key, column: 'amount', value: '1250.00' }],
    })
    // the page is fetched again after apply
    expect(calls.filter((c) => c.path === '/p/local/query').length).toBeGreaterThanOrEqual(2)
  })

  it('does not stage a value equal to the current one', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit amount' }), '{Enter}')
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()
  })

  it('rejects an invalid value with a message and keeps the editor open', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    const box = screen.getByRole('textbox', { name: 'Edit amount' })
    await userEvent.clear(box)
    await userEvent.type(box, 'lots{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a decimal number')
    expect(box).toBeInTheDocument()
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()
  })

  it('clears a cell with Set null', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    await userEvent.click(screen.getByRole('button', { name: 'Set null' }))
    expect(await screen.findByText('1 pending change')).toBeInTheDocument()
    expect(useWorkspace.getState().edits[tableTab.id][0].changes[0]).toMatchObject({ kind: 'set_null', column: 'amount' })
  })

  it('keeps primary key cells read-only and says why', async () => {
    open()
    render(<TableView tab={tableTab} />)
    const cell = (await screen.findAllByText(MERCHANT))[0].closest('[role="cell"]')!
    expect(cell).toHaveAttribute('aria-readonly', 'true')
    expect(cell).toHaveAttribute('title', expect.stringMatching(/Primary key cells are read-only/))
    await userEvent.dblClick(cell)
    expect(screen.queryByRole('textbox', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('opens the editor with Enter on a selected cell', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await userEvent.click(await screen.findByText('1180.00'))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Edit amount' })).toHaveFocus()
  })

  it('adds a tag to a set<text> cell: SET tags = tags + ? is what Apply sends', async () => {
    const calls = open({ 'POST /p/local/changes/apply': { body: applied(1) } })
    render(<TableView tab={tableTab} />)
    await userEvent.dblClick(await screen.findByText("{'gold'}"))
    const pop = screen.getByRole('dialog', { name: 'Edit tags' })
    await userEvent.type(within(pop).getByRole('textbox', { name: 'New member' }), 'vip')
    await userEvent.click(within(pop).getByRole('button', { name: 'Add' }))
    await userEvent.click(within(pop).getByRole('button', { name: 'Stage change' }))

    expect(await screen.findByText('1 pending change')).toBeInTheDocument()
    expect(screen.getByText("{'gold', 'vip'}")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(applyCall(calls)).toBeDefined())
    expect(applyCall(calls).changes).toEqual([{ kind: 'set_add', key, column: 'tags', value: ['vip'] }])
  })

  it('edits a frozen UDT as one whole-value replacement', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await userEvent.dblClick(await screen.findByText(/street: '1 Main St'/))
    const pop = screen.getByRole('dialog', { name: 'Edit billing' })
    const street = within(pop).getByRole('textbox', { name: 'Field street' })
    await userEvent.clear(street)
    await userEvent.type(street, '2 High St')
    await userEvent.click(within(pop).getByRole('button', { name: 'Stage change' }))
    expect(await screen.findByText('1 pending change')).toBeInTheDocument()
    expect(useWorkspace.getState().edits[tableTab.id][0].changes[0]).toMatchObject({ kind: 'replace_value', column: 'billing', value: { street: '2 High St', postal_code: '411001' } })
  })

  it('unstages a collection edit that is changed back', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await userEvent.dblClick(await screen.findByText("{'gold'}"))
    let pop = screen.getByRole('dialog', { name: 'Edit tags' })
    await userEvent.type(within(pop).getByRole('textbox', { name: 'New member' }), 'vip')
    await userEvent.click(within(pop).getByRole('button', { name: 'Add' }))
    await userEvent.click(within(pop).getByRole('button', { name: 'Stage change' }))
    await userEvent.dblClick(await screen.findByText("{'gold', 'vip'}"))
    pop = screen.getByRole('dialog', { name: 'Edit tags' })
    await userEvent.click(within(pop).getByRole('button', { name: 'Remove vip' }))
    await userEvent.click(within(pop).getByRole('button', { name: 'Stage change' }))
    await waitFor(() => expect(screen.queryByText(/pending change/)).not.toBeInTheDocument())
  })

  it('stages a counter increment as a delta', async () => {
    const calls = open({ 'POST /p/local/changes/apply': { body: applied(1) } }, counterTab, counterResponse())
    render(<TableView tab={counterTab} />)
    await dbl('10')
    const box = screen.getByRole('textbox', { name: 'Edit debits' })
    expect(box).toHaveValue('')
    await userEvent.type(box, '5{Enter}')
    expect(await screen.findByText('10 (+5)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(applyCall(calls)).toBeDefined())
    expect(applyCall(calls).changes).toEqual([{ kind: 'counter_delta', key: { account_id: MERCHANT, day: '2026-09-30' }, column: 'debits', value: '5' }])
  })

  it('does not offer insert or delete on a counter table', async () => {
    open({}, counterTab, counterResponse())
    render(<TableView tab={counterTab} />)
    await screen.findByText('10')
    expect(screen.getByRole('button', { name: /Insert row/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Delete row/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Duplicate row/ })).not.toBeInTheDocument()
  })

  it('stages an inserted row at the top of the grid', async () => {
    const calls = open({ 'POST /p/local/changes/apply': { body: applied(1) } })
    render(<TableView tab={tableTab} />)
    await screen.findByText('1180.00')
    await userEvent.click(screen.getByRole('button', { name: /Insert row/ }))
    const dialog = screen.getByRole('dialog', { name: 'Insert row' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'merchant_id' }), MERCHANT)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'txn_day' }), '2026-10-01')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'txn_time' }), '3f1a2b10-9d3c-11ef-8a6e-0242ac120009')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'amount' }), '5')
    await userEvent.click(within(dialog).getByRole('switch', { name: 'IF NOT EXISTS' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stage insert' }))

    expect(await screen.findByText('1 insert')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('+')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(applyCall(calls)).toBeDefined())
    expect(applyCall(calls).changes).toEqual([
      {
        kind: 'insert_row',
        if_not_exists: true,
        values: { merchant_id: MERCHANT, txn_day: '2026-10-01', txn_time: '3f1a2b10-9d3c-11ef-8a6e-0242ac120009', amount: '5' },
      },
    ])
  })

  it('duplicates the selected row into an insert prefilled with its values', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await userEvent.click((await screen.findAllByRole('rowheader'))[0])
    await userEvent.click(screen.getByRole('button', { name: /Duplicate row/ }))
    const dialog = screen.getByRole('dialog', { name: 'Duplicate row' })
    expect(within(dialog).getByRole('textbox', { name: 'amount' })).toHaveValue('1180.00')
    expect(within(dialog).getByRole('textbox', { name: 'txn_time' })).toHaveValue(TXN)
  })

  it('shows a deleted row struck through until applied, and can restore it', async () => {
    const calls = open({ 'POST /p/local/changes/apply': { body: applied(1) } })
    render(<TableView tab={tableTab} />)
    await userEvent.click((await screen.findAllByRole('rowheader'))[0])
    await userEvent.click(screen.getByRole('button', { name: 'Delete row' }))
    expect(await screen.findByText('1 delete')).toBeInTheDocument()
    expect(screen.getByText('1180.00').closest('[role="cell"]')).toHaveClass('line-through')
    expect(screen.getByText('1180.00').closest('[role="cell"]')).toHaveAttribute('title', 'This row is staged for deletion.')

    await userEvent.click(screen.getByRole('button', { name: 'Restore row' }))
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete row' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(applyCall(calls)).toBeDefined())
    expect(applyCall(calls).changes).toEqual([{ kind: 'delete_row', key }])
  })

  it('shows the CQL for review before anything runs', async () => {
    const calls = open({
      'POST /p/local/changes/preview': { statements: [{ index: 0, kind: 'set_cell', cql: 'UPDATE payments.t SET amount = ? WHERE a = ?;', preview: 'UPDATE payments.t SET amount = 1250.00 WHERE a = 1;', summary: 'set amount' }] },
    })
    render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    const box = screen.getByRole('textbox', { name: 'Edit amount' })
    await userEvent.clear(box)
    await userEvent.type(box, '1250.00{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Review CQL' }))
    expect(await screen.findByText('UPDATE payments.t SET amount = 1250.00 WHERE a = 1;')).toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('/apply'))).toBe(false)
  })

  it('leaves a failed change and the ones after it pending, with the error inline', async () => {
    const failed: ApplyResponse = {
      results: [
        { index: 0, status: 'applied', executed_cql: '' },
        { index: 1, status: 'failed', executed_cql: '', error: { code: 'query_failed', message: 'Invalid decimal value' } },
        { index: 2, status: 'pending', executed_cql: '' },
      ],
      applied: 1,
      failed_at: 1,
    }
    open({ 'POST /p/local/changes/apply': { body: failed } })
    render(<TableView tab={tableTab} />)
    for (const [text, value] of [['1180.00', '1.00'], ['49.99', '2.00'], ['Acme', 'Beta']] as const) {
      await userEvent.dblClick((await screen.findAllByText(text))[0])
      const box = screen.getByRole('textbox', { name: /^Edit / })
      await userEvent.clear(box)
      await userEvent.type(box, `${value}{Enter}`)
    }
    expect(await screen.findByText('3 pending changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))

    expect(await screen.findByText('2 pending changes')).toBeInTheDocument()
    expect(screen.getByText(/failed: Invalid decimal value/)).toBeInTheDocument()
    expect(screen.getByText('2.00').closest('[role="cell"]')).toHaveAttribute('title', 'Invalid decimal value')
    const left = useWorkspace.getState().edits[tableTab.id]
    expect(left.map((i) => i.column)).toEqual(['amount', 'merchant_name'])
  })

  it('asks before discarding and then clears the staged edits', async () => {
    open()
    render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit amount' }), '1{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    const dialog = screen.getByRole('dialog', { name: 'Discard pending changes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('1 pending change')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Discard pending changes' })).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()
    expect(screen.getByText('1180.00')).toBeInTheDocument()
  })

  it('keeps staged edits when the tab is closed and reopened in the same session', async () => {
    open()
    const first = render(<TableView tab={tableTab} />)
    await dbl('1180.00')
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit amount' }), '9{Enter}')
    expect(await screen.findByText('1 pending change')).toBeInTheDocument()
    first.unmount()
    render(<TableView tab={tableTab} />)
    expect(await screen.findByText('1 pending change')).toBeInTheDocument()
  })

  it('is read-only for a materialized view, with the reason', async () => {
    open({}, viewTab, txnResponse())
    render(<TableView tab={viewTab} />)
    expect(await screen.findByText(/Materialized views are read-only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Insert row/ })).toBeDisabled()
    await userEvent.dblClick(await screen.findByText('1180.00'))
    expect(screen.queryByRole('textbox', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('is read-only in a system keyspace, with the reason', async () => {
    open({}, systemTab, txnResponse())
    render(<TableView tab={systemTab} />)
    expect(await screen.findByText(/system keyspaces are read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Insert row/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Read-only').length).toBeGreaterThan(0)
  })

  it('is read-only when the result lacks primary key columns', async () => {
    const noKey = txnResponse()
    noKey.columns = noKey.columns.filter((c) => c.name !== 'txn_time')
    noKey.rows = noKey.rows.map((r) => r.filter((_, i) => i !== 2))
    open({}, tableTab, noKey)
    render(<TableView tab={tableTab} />)
    expect(await screen.findByText(/missing primary key column txn_time/)).toBeInTheDocument()
  })

  it('shows a truncated blob key as not editable', async () => {
    const rows = txnResponse()
    rows.columns[2] = { ...rows.columns[2], type: { name: 'blob' } }
    rows.rows[0][2] = { $truncated: true, preview: '0x00', bytes: 99999 }
    open({}, tableTab, rows)
    render(<TableView tab={tableTab} />)
    const cell = (await screen.findByText('1180.00')).closest('[role="cell"]')!
    expect(cell).toHaveAttribute('title', expect.stringMatching(/too large to send back/))
  })
})
