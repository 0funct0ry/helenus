import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { RecordPanel } from './RecordPanel'
import type { RecordPanelProps } from './RecordPanel'

const columns: RecordPanelProps['columns'] = [
  { name: 'id', type: 'int', kind: 'partition', position: 1 },
  { name: 'note', type: 'text', kind: 'regular' },
  { name: 'tags', type: 'set<text>', kind: 'regular' },
  { name: 'raw', type: 'blob', kind: 'regular' },
]
const rows = [{ id: 1, note: null, tags: "{'a', 'b'}", raw: '0x0aff' }]

function setup(over: Partial<RecordPanelProps> = {}) {
  const props: RecordPanelProps = {
    columns,
    rows,
    wireRow: () => [1, null, ['a', 'b'], '0x0aff'],
    indices: [0],
    position: 0,
    onStep: vi.fn(),
    onClose: vi.fn(),
    onCopyRow: vi.fn(),
    formatReason: (f) => (f === 'sql_inserts' ? 'No single table' : null),
    ...over,
  }
  render(<RecordPanel {...props} />)
  return props
}

describe('RecordPanel', () => {
  it('lists every column with key marker, type badge and value', () => {
    setup()
    expect(screen.getByLabelText('Partition key 1')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'note' })).getByText('null')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'tags' })).getByText(/"a"/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'raw' })).getByText('2 bytes')).toBeInTheDocument()
  })
  it('hides the stepper for one record and shows it for several', async () => {
    const p = setup({ indices: [0, 4], position: 1 })
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous record' }))
    expect(p.onStep).toHaveBeenCalledWith(-1)
    expect(screen.getByRole('button', { name: 'Next record' })).toBeDisabled()
  })
  it('shows a pending edit with the changed marker', () => {
    setup({ rows: [{ ...rows[0], note: 'edited' }], meta: [{ kind: 'row', source: 0, cells: { note: { changed: true, was: null } } }] })
    const note = screen.getByRole('region', { name: 'note' })
    expect(within(note).getByText('edited')).toBeInTheDocument()
    expect(within(note).getByText('changed')).toBeInTheDocument()
  })
  it('copies the row in a format, disabled formats carry their reason, and Escape / X close', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Copy row as ▸' }))
    const sql = screen.getByRole('menuitem', { name: 'SQL Inserts' })
    expect(sql).toHaveAttribute('title', 'No single table')
    await userEvent.click(sql)
    expect(p.onCopyRow).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('menuitem', { name: 'CSV' }))
    expect(p.onCopyRow).toHaveBeenCalledWith('csv', 0)
    screen.getByRole('button', { name: 'Close record view' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(p.onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close record view' }))
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })
})
