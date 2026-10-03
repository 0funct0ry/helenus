import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewChangesDialog } from './ReviewChangesDialog'
import { mockApi, renderWithClient as render } from '../test/api'
import type { PendingItem } from '../lib/changes'
import type { ApplyResponse } from '../api/types'

const items: PendingItem[] = [
  { id: 'a', type: 'cell', rowKey: 'r', column: 'tags', changes: [{ kind: 'set_add', column: 'tags', key: { id: '1' }, value: ['vip'] }] },
  { id: 'b', type: 'cell', rowKey: 'r', column: 'status', changes: [{ kind: 'set_cell', column: 'status', key: { id: '1' }, value: 'x' }] },
]
const statements = [
  { index: 0, kind: 'set_add', cql: 'UPDATE ks.t SET tags = tags + ? WHERE id = ?;', preview: "UPDATE ks.t SET tags = tags + {'vip'} WHERE id = 1;", summary: 'add to tags' },
  { index: 1, kind: 'set_cell', cql: 'UPDATE ks.t SET status = ? WHERE id = ?;', preview: "UPDATE ks.t SET status = 'x' WHERE id = 1;", summary: 'set status' },
]

function setup(apply: ApplyResponse | { status: number; body: unknown }, onApplied = vi.fn(), onClose = vi.fn()) {
  const calls = mockApi({
    'POST /p/local/changes/preview': { statements },
    'POST /p/local/changes/apply': 'status' in apply ? apply : { body: apply },
  })
  render(<ReviewChangesDialog open onClose={onClose} profile="local" keyspace="ks" table="t" consistency="LOCAL_QUORUM" items={items} onApplied={onApplied} />)
  return { calls, onApplied, onClose }
}

describe('ReviewChangesDialog', () => {
  it('shows the compiled CQL for every staged change', async () => {
    const { calls } = setup({ results: [], applied: 0, failed_at: -1 })
    expect(await screen.findByText("UPDATE ks.t SET tags = tags + {'vip'} WHERE id = 1;")).toBeInTheDocument()
    expect(screen.getByText('-- 1 of 2 · add to tags')).toBeInTheDocument()
    expect(screen.getByText('Runs one statement at a time at LOCAL_QUORUM')).toBeInTheDocument()
    expect(calls[0].body).toEqual({
      keyspace: 'ks',
      table: 't',
      consistency: 'LOCAL_QUORUM',
      changes: [items[0].changes[0], items[1].changes[0]],
    })
  })

  it('applies, reports the response and closes when everything succeeded', async () => {
    const res: ApplyResponse = {
      results: [
        { index: 0, status: 'applied', executed_cql: '' },
        { index: 1, status: 'applied', executed_cql: '' },
      ],
      applied: 2,
      failed_at: -1,
    }
    const { onApplied, onClose, calls } = setup(res)
    await screen.findByText(/UPDATE ks.t SET tags/)
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(res))
    expect(onClose).toHaveBeenCalled()
    expect(calls.some((c) => c.path === '/p/local/changes/apply')).toBe(true)
  })

  it('stays open after a failure and shows the status and error inline', async () => {
    const res: ApplyResponse = {
      results: [
        { index: 0, status: 'applied', executed_cql: '' },
        { index: 1, status: 'failed', executed_cql: '', error: { code: 'query_failed', message: 'Invalid STRING constant' } },
      ],
      applied: 1,
      failed_at: 1,
    }
    const { onApplied, onClose } = setup(res)
    await screen.findByText(/UPDATE ks.t SET tags/)
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByText('Invalid STRING constant')).toBeInTheDocument()
    expect(screen.getByText('Applied')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(onApplied).toHaveBeenCalledWith(res)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retry remaining' })).toBeInTheDocument()
  })

  it('shows a rejection from the server instead of CQL', async () => {
    mockApi({ 'POST /p/local/changes/preview': { status: 422, body: { error: { code: 'invalid_change', message: 'change 2: tags is frozen' } } } })
    render(<ReviewChangesDialog open onClose={() => {}} profile="local" keyspace="ks" table="t" consistency="ONE" items={items} onApplied={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('tags is frozen')
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
  })

  it('closes without applying', async () => {
    const { onClose, calls } = setup({ results: [], applied: 0, failed_at: -1 })
    await screen.findByText(/UPDATE ks.t SET tags/)
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(onClose).toHaveBeenCalled()
    expect(calls.some((c) => c.path.endsWith('/apply'))).toBe(false)
  })
})

describe('ReviewChangesDialog failed changes', () => {
  it('offers to discard the failed change so the rest can run', async () => {
    const res: ApplyResponse = {
      results: [
        { index: 0, status: 'failed', executed_cql: '', error: { code: 'not_applied', message: 'exists' } },
        { index: 1, status: 'pending', executed_cql: '' },
      ],
      applied: 0,
      failed_at: 0,
    }
    const onDropFailed = vi.fn()
    mockApi({ 'POST /p/local/changes/preview': { statements }, 'POST /p/local/changes/apply': { body: res } })
    render(<ReviewChangesDialog open onClose={() => {}} profile="local" keyspace="ks" table="t" consistency="ONE" items={items} onApplied={() => {}} onDropFailed={onDropFailed} />)
    await screen.findByText(/UPDATE ks.t SET tags/)
    expect(screen.queryByRole('button', { name: 'Discard failed change' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard failed change' }))
    expect(onDropFailed).toHaveBeenCalled()
  })
})
