import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ResultsGrid } from './ResultsGrid'
import type { ResultsGridProps } from './ResultsGrid'
import type { QueryColumn } from '../api/types'
import { useToasts } from '../store/toast'

const { formatRows, aggregateRows } = vi.hoisted(() => ({ formatRows: vi.fn(), aggregateRows: vi.fn() }))
vi.mock('../api/rows', () => ({ formatRows, aggregateRows }))

const wireCols: QueryColumn[] = [
  { name: 'id', type: { name: 'bigint' }, kind: 'partition', position: 0 },
  { name: 'Name', type: { name: 'text' }, kind: 'regular' },
  { name: 'tags', type: { name: 'map', args: [{ name: 'text' }, { name: 'int' }] }, kind: 'regular' },
]
const wire: unknown[][] = [
  ['100', 'bob', [['a', 1]]],
  [null, 'amy', null],
  ['9', 'cy', null],
  ['10', 'amy', null],
]
const columns = [
  { name: 'id', type: 'bigint', kind: 'partition' as const, position: 0 },
  { name: 'Name', type: 'text', kind: 'regular' as const },
  { name: 'tags', type: 'map<text, int>', kind: 'regular' as const },
]
const rows = wire.map((r) => ({ id: r[0] as string | null, Name: r[1] as string, tags: r[2] ? "{'a': 1}" : null }))

function setup(over: Partial<ResultsGridProps> = {}) {
  const onDelete = vi.fn()
  const utils = render(
    <ResultsGrid
      columns={columns}
      rows={rows}
      data={{ columns: wireCols, wireRow: (i) => wire[i], source: { keyspace: 'ks', table: 't', keysComplete: true }, actions: { disabledReason: null, onAdd: vi.fn(), onClone: vi.fn(), onDelete } }}
      {...over}
    />,
  )
  return { ...utils, onDelete }
}
const header = (name: string) => screen.getAllByRole('columnheader').find((h) => h.dataset.colheader === name)!
const idCells = () => screen.getAllByRole('cell').filter((c) => c.dataset.col === 'id').map((c) => c.textContent)
const menuItem = (name: RegExp | string) => screen.getByRole('menuitem', { name })

beforeEach(() => {
  formatRows.mockReset()
  useToasts.setState({ toasts: [] } as never)
})

describe('column selection', () => {
  it('selects one column, extends with Ctrl and Shift, and clears with a cell click or Escape', async () => {
    setup()
    await userEvent.click(header('id'))
    expect(header('id')).toHaveAttribute('aria-selected', 'true')
    expect(header('Name')).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(header('id')) // clicking the only selected column keeps it
    expect(header('id')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(header('tags'), { ctrlKey: true })
    expect(header('tags')).toHaveAttribute('aria-selected', 'true')
    expect(header('Name')).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(header('Name'), { shiftKey: true })
    expect(header('Name')).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByText('bob'))
    expect(header('id')).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(header('Name'))
    fireEvent.keyDown(header('Name'), { key: 'Escape' })
    expect(header('Name')).toHaveAttribute('aria-selected', 'false')
  })
  it('is exclusive with row selection and keyboard operable', async () => {
    setup()
    await userEvent.click(screen.getByText('bob'))
    expect(screen.getAllByRole('rowheader').some((h) => h.getAttribute('aria-selected') === 'true')).toBe(true)
    header('id').focus()
    await userEvent.keyboard('{Enter}')
    expect(header('id')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('rowheader').some((h) => h.getAttribute('aria-selected') === 'true')).toBe(false)
    await userEvent.keyboard('{ArrowRight}')
    expect(header('Name')).toHaveFocus()
  })
})

describe('column menu', () => {
  it('acts on the clicked column without changing the selection', async () => {
    setup()
    await userEvent.click(header('id'))
    fireEvent.contextMenu(header('Name'))
    expect(screen.getByRole('menu', { name: 'Column actions' })).toHaveTextContent('Name')
    expect(menuItem('Copy Column Name')).toBeInTheDocument()
    expect(header('id')).toHaveAttribute('aria-selected', 'true')
    expect(header('Name')).toHaveAttribute('aria-selected', 'false')
  })
  it('acts on the whole selection when right-clicking inside it', async () => {
    setup()
    await userEvent.click(header('id'))
    fireEvent.click(header('tags'), { shiftKey: true })
    fireEvent.contextMenu(header('Name'))
    expect(screen.getByRole('menu', { name: 'Column actions' })).toHaveTextContent('3 columns')
    expect(menuItem('Hide 3 columns')).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Select Columns')).toHaveAttribute('aria-disabled', 'true')
  })
  it('opens from the keyboard', async () => {
    setup()
    header('id').focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menu', { name: 'Column actions' })).toBeInTheDocument()
  })
  it('copies CQL-quoted names of the selected columns', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    setup()
    await userEvent.click(header('id'))
    fireEvent.click(header('Name'), { ctrlKey: true })
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Copy Column Names'))
    expect(writeText).toHaveBeenCalledWith('id, "Name"')
    await vi.waitFor(() => expect(useToasts.getState().toasts.map((t) => t.message)).toContain('Copied 2 column names'))
  })
})

describe('sort', () => {
  it('orders a bigint column numerically with NULLs last in both directions', async () => {
    setup()
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Sort ascending'))
    expect(idCells()).toEqual(['9', '10', '100', 'null'])
    expect(header('id')).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByText('Sorted on this page only')).toBeInTheDocument()
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Sort descending'))
    expect(idCells()).toEqual(['100', '10', '9', 'null'])
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Clear sorting'))
    expect(idCells()).toEqual(['100', 'null', '9', '10'])
    expect(screen.queryByText('Sorted on this page only')).toBeNull()
  })
  it('disables sorting for a map column with a reason', () => {
    setup()
    fireEvent.contextMenu(header('tags'))
    expect(menuItem('Sort ascending')).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Sort ascending')).toHaveAttribute('title', 'This type can’t be sorted')
    expect(menuItem('Clear sorting')).toHaveAttribute('aria-disabled', 'true')
  })
  it('stages a delete for the row’s own record after sort and filter', async () => {
    const { onDelete } = setup()
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Sort ascending'))
    // display order: 9 (src 2), 10 (src 3), 100 (src 0), null (src 1)
    const third = screen.getAllByRole('row')[3]
    fireEvent.contextMenu(within(third).getByText('100'))
    await userEvent.click(menuItem('Delete row'))
    expect(onDelete).toHaveBeenCalledWith([0])
  })
})

describe('local filter', () => {
  const applyGreater = async (value: string) => {
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Set local filter'))
    await userEvent.click(screen.getByRole('button', { name: /Operator/ }))
    await userEvent.click(screen.getByRole('option', { name: '>' }))
    await userEvent.type(screen.getByLabelText('Value'), value)
  }
  it('hides non-matching and NULL rows, shows the chip and footer, and clears', async () => {
    setup()
    await applyGreater('9')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(idCells()).toEqual(['100', '10'])
    expect(screen.getByText(/Filtered: 2 of 4 rows on this page/)).toBeInTheDocument()
    expect(screen.getByTitle('> 9')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(idCells()).toHaveLength(4)
    expect(screen.getByText('4 rows on this page')).toBeInTheDocument()
  })
  it('applies with Enter and removes rows from the row selection', async () => {
    setup()
    await userEvent.click(screen.getByText('cy')) // id 9 selected
    await applyGreater('9{Enter}')
    expect(idCells()).toEqual(['100', '10'])
    expect(screen.getAllByRole('rowheader').every((h) => h.getAttribute('aria-selected') !== 'true')).toBe(true)
  })
  it('disables Apply with an inline error for invalid numbers', async () => {
    setup()
    await applyGreater('abc')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })
  it('offers only null checks and contains for a map column', async () => {
    setup()
    fireEvent.contextMenu(header('tags'))
    await userEvent.click(menuItem('Set local filter'))
    await userEvent.click(screen.getByRole('button', { name: /Operator/ }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['contains', 'is null', 'is not null'])
  })
})

describe('Copy Column as', () => {
  it('copies only the visible values of the filtered, sorted column', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    formatRows.mockResolvedValue('id\n9\n10')
    setup()
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Sort ascending'))
    fireEvent.contextMenu(header('Name'))
    await userEvent.click(menuItem('Set local filter'))
    await userEvent.click(screen.getByRole('button', { name: /Operator/ }))
    await userEvent.click(screen.getByRole('option', { name: 'equals' }))
    await userEvent.type(screen.getByLabelText('Value'), 'cy{Enter}')
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Copy Column as'))
    await userEvent.click(menuItem('CSV'))
    expect(formatRows).toHaveBeenCalledWith(expect.anything(), { format: 'csv', source: null, columns: [wireCols[0]], rows: [['9']] })
    expect(writeText).toHaveBeenCalledWith('id\n9\n10')
    await vi.waitFor(() => expect(useToasts.getState().toasts.map((t) => t.message)).toContain('Copied column as CSV'))
  })
  it('offers all eight formats, always enabled', async () => {
    setup()
    fireEvent.contextMenu(header('tags'))
    await userEvent.click(menuItem('Copy Column as'))
    const labels = ['JSON', 'CSV', 'TSV', 'XML', 'YAML', 'Markdown', 'HTML', 'SQL']
    for (const l of labels) expect(menuItem(l)).not.toHaveAttribute('aria-disabled', 'true')
  })
})

describe('hide and show', () => {
  it('hides the column, shows the footer indicator and restores it in place', async () => {
    setup()
    fireEvent.contextMenu(header('Name'))
    await userEvent.click(menuItem('Hide column'))
    expect(screen.getAllByRole('columnheader').map((h) => h.dataset.colheader).filter(Boolean)).toEqual(['id', 'tags'])
    expect(screen.getByText(/1 column hidden/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getAllByRole('columnheader').map((h) => h.dataset.colheader).filter(Boolean)).toEqual(['id', 'Name', 'tags'])
    fireEvent.contextMenu(header('Name'))
    expect(menuItem('Show All Columns')).toHaveAttribute('aria-disabled', 'true')
  })
  it('blocks hiding every column', async () => {
    setup({ columns: columns.slice(0, 1), data: undefined, rows: rows.map((r) => ({ id: r.id })) })
    fireEvent.contextMenu(header('id'))
    expect(menuItem('Hide column')).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Hide column')).toHaveAttribute('title', 'At least one column must stay visible')
  })
  it('excludes hidden columns from Copy As', async () => {
    formatRows.mockResolvedValue('x')
    setup()
    fireEvent.contextMenu(header('Name'))
    await userEvent.click(menuItem('Hide column'))
    fireEvent.contextMenu(screen.getAllByRole('cell').find((c) => c.dataset.col === 'id')!)
    await userEvent.click(menuItem('Copy As'))
    await userEvent.click(menuItem('CSV'))
    expect(formatRows).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ columns: [wireCols[0], wireCols[2]], rows: [['100', [['a', 1]]]] }))
  })
})

describe('reset', () => {
  it('resets sort on a new page but keeps hidden columns', async () => {
    const { rerender } = setup({ resetKey: 1, viewKey: 'q' })
    fireEvent.contextMenu(header('id'))
    await userEvent.click(menuItem('Sort ascending'))
    fireEvent.contextMenu(header('Name'))
    await userEvent.click(menuItem('Hide column'))
    rerender(<ResultsGrid columns={columns} rows={rows} resetKey={2} viewKey="q" />)
    expect(screen.queryByText('Sorted on this page only')).toBeNull()
    expect(screen.getByText(/1 column hidden/)).toBeInTheDocument()
    rerender(<ResultsGrid columns={columns} rows={rows} resetKey={3} viewKey="other" />)
    expect(screen.queryByText(/column hidden/)).toBeNull()
  })
})
