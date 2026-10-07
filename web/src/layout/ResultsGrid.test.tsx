import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ResultsGrid } from './ResultsGrid'
import { dataColumns, dataRows } from '../mocks/rows'
import type { QueryColumn } from '../api/types'

const { formatRows, aggregateRows } = vi.hoisted(() => ({ formatRows: vi.fn(), aggregateRows: vi.fn() }))
vi.mock('../api/rows', () => ({ formatRows, aggregateRows }))

const wireCols: QueryColumn[] = [
  { name: 'a', type: { name: 'text' }, kind: 'regular' },
  { name: 'b', type: { name: 'int' }, kind: 'regular' },
]

describe('ResultsGrid', () => {
  it('renders headers with kind markers and type badges', () => {
    render(<ResultsGrid columns={dataColumns} rows={dataRows} />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(dataColumns.length + 1)
    expect(screen.getByLabelText('Partition key 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Clustering key 1 DESC')).toBeInTheDocument()
    expect(screen.getByLabelText('Static column')).toBeInTheDocument()
    expect(within(headers[3]).getByText('timeuuid')).toBeInTheDocument()
  })
  it('renders rows and dim null', () => {
    render(<ResultsGrid columns={dataColumns} rows={dataRows} />)
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
    const nulls = screen.getAllByText('null')
    expect(nulls[0]).toHaveClass('text-dim')
    expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0)
  })
  it('shows the footer and wires paging', async () => {
    const onNext = vi.fn()
    render(<ResultsGrid columns={dataColumns} rows={dataRows} page={2} elapsedMs={41} consistency="LOCAL_QUORUM" hasNext hasPrev={false} onNext={onNext} />)
    expect(screen.getByText('12 rows on this page')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(screen.getByText('41 ms')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onNext).toHaveBeenCalled()
  })
  it('is read-only: cells are not editable', () => {
    const { container } = render(<ResultsGrid columns={dataColumns} rows={dataRows} />)
    expect(container.querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
  })
  it('shows the embedded time of a timeuuid as a tooltip', () => {
    render(<ResultsGrid columns={[{ name: 't', type: 'timeuuid', kind: 'regular' }]} rows={[{ t: 'd9f2a1c0-9c9d-11f1-8b3a-0242ac120002' }]} />)
    expect(screen.getByText('d9f2a1c0-9c9d-11f1-8b3a-0242ac120002')).toHaveAttribute('title', expect.stringMatching(/^20\d\d-/))
  })
  it('wires Count rows', async () => {
    const onCount = vi.fn()
    render(<ResultsGrid columns={dataColumns} rows={dataRows} showCount onCount={onCount} />)
    await userEvent.click(screen.getByRole('button', { name: 'Count rows' }))
    expect(onCount).toHaveBeenCalled()
  })
  it('copies a cell locally and a row / selection through the server formatter', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    formatRows.mockImplementation(async (_p: string, req: { format: string }) => `${req.format}-text`)
    const cols = [{ name: 'a', type: 'text', kind: 'regular' as const }, { name: 'b', type: 'int', kind: 'regular' as const }]
    const rows = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }]
    const data = { columns: wireCols, wireRow: (i: number) => [rows[i].a, rows[i].b], source: null }
    render(<ResultsGrid columns={cols} rows={rows} data={data} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
    await userEvent.click(screen.getByText('x'))
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy cell' }))
    expect(writeText).toHaveBeenLastCalledWith('x')
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy row as JSON' }))
    expect(formatRows).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ format: 'json', rows: [['x', 1]] }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('json-text'))
    await userEvent.click(screen.getByText('1', { selector: '[role=rowheader]' }))
    fireEvent.click(screen.getByText('2', { selector: '[role=rowheader]' }), { shiftKey: true })
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy selection as TSV' }))
    expect(formatRows).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ format: 'tsv', rows: [['x', 1], ['y', 2]] }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('tsv-text'))
  })

  describe('row menu', () => {
    const cols = [{ name: 'a', type: 'text', kind: 'regular' as const }, { name: 'b', type: 'int', kind: 'regular' as const }]
    const rows = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }, { a: 'z', b: 3 }]
    const wire = (i: number) => [rows[i].a, rows[i].b]
    const actions = () => ({ disabledReason: null, onAdd: vi.fn(), onClone: vi.fn(), onDelete: vi.fn() })

    it('selects an unselected row on right-click and shows "1 row"', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null, actions: actions() }} />)
      fireEvent.contextMenu(screen.getByText('y'))
      expect(await screen.findByRole('menu', { name: 'Row actions' })).toBeInTheDocument()
      expect(screen.getByText('1 row')).toBeInTheDocument()
      expect(screen.getByText('2', { selector: '[role=rowheader]' })).toHaveAttribute('aria-selected', 'true')
    })

    it('keeps a multi-row selection when right-clicking inside it and pluralises the labels', async () => {
      const a = actions()
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null, actions: a }} />)
      await userEvent.click(screen.getByText('1', { selector: '[role=rowheader]' }))
      fireEvent.click(screen.getByText('3', { selector: '[role=rowheader]' }), { shiftKey: true })
      fireEvent.contextMenu(screen.getByText('y'))
      expect(await screen.findByText('3 rows')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete 3 rows' }))
      expect(a.onDelete).toHaveBeenCalledWith([0, 1, 2])
    })

    it('opens with Shift+F10 on the selected row and closes on Escape', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null, actions: actions() }} />)
      await userEvent.click(screen.getByText('x'))
      fireEvent.keyDown(screen.getByRole('table').parentElement!, { key: 'F10', shiftKey: true })
      expect(await screen.findByRole('menu', { name: 'Row actions' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('menu', { name: 'Row actions' })).not.toBeInTheDocument()
    })

    it('disables row edits with the reason and SQL formats without a source table', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      fireEvent.contextMenu(screen.getByText('x'))
      const add = await screen.findByRole('menuitem', { name: 'Add row' })
      expect(add).toHaveAttribute('aria-disabled', 'true')
      expect(add).toHaveAttribute('title', expect.stringContaining('Data view'))
      await userEvent.hover(screen.getByRole('menuitem', { name: 'Copy As' }))
      expect(await screen.findByRole('menuitem', { name: 'SQL Inserts' })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('menuitem', { name: 'CSV' })).not.toHaveAttribute('aria-disabled')
    })

    it('copies as CSV through the server and toasts', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      formatRows.mockResolvedValue('a,b\nx,1')
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      fireEvent.contextMenu(screen.getByText('x'))
      await userEvent.hover(await screen.findByRole('menuitem', { name: 'Copy As' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'CSV' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('a,b\nx,1'))
      expect(formatRows).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ format: 'csv', source: null, rows: [['x', 1]] }))
    })

    it('leaves the clipboard alone when formatting fails', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      formatRows.mockRejectedValue(new Error('boom'))
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      fireEvent.contextMenu(screen.getByText('x'))
      await userEvent.hover(await screen.findByRole('menuitem', { name: 'Copy As' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'JSON' }))
      await waitFor(() => expect(formatRows).toHaveBeenCalled())
      expect(writeText).not.toHaveBeenCalled()
    })

    it('opens the record view, which follows row clicks and steps with the arrows', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      fireEvent.contextMenu(screen.getByText('x'))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Show record view' }))
      const panel = screen.getByRole('complementary', { name: 'Record view' })
      expect(within(panel).getByText('1 of 3')).toBeInTheDocument()
      await userEvent.click(screen.getByText('z'))
      expect(within(panel).getByText('3 of 3')).toBeInTheDocument()
      await userEvent.click(within(panel).getByRole('button', { name: 'Previous record' }))
      expect(within(panel).getByText('2 of 3')).toBeInTheDocument()
      await userEvent.click(within(panel).getByRole('button', { name: 'Close record view' }))
      expect(screen.queryByRole('complementary', { name: 'Record view' })).not.toBeInTheDocument()
    })

    it('steps only through a multi-row selection', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      await userEvent.click(screen.getByText('1', { selector: '[role=rowheader]' }))
      fireEvent.click(screen.getByText('2', { selector: '[role=rowheader]' }), { shiftKey: true })
      fireEvent.contextMenu(screen.getByText('x'))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Show record view' }))
      const panel = screen.getByRole('complementary', { name: 'Record view' })
      expect(within(panel).getByText('1 of 2')).toBeInTheDocument()
      await userEvent.click(within(panel).getByRole('button', { name: 'Next record' }))
      expect(within(panel).getByText('2 of 2')).toBeInTheDocument()
      expect(within(panel).getByRole('button', { name: 'Next record' })).toBeDisabled()
    })

    it('shows the aggregate view from the server figures', async () => {
      aggregateRows.mockResolvedValue({ lines: [{ key: 'COUNT', value: '4' }, { key: 'SUM', value: '6' }], text: 'COUNT: 4\nSUM: 6' })
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      fireEvent.contextMenu(screen.getByText('x'))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Show aggregate view' }))
      expect(await screen.findByLabelText('Aggregate figures')).toHaveTextContent(/COUNT:\s+4\s+SUM:\s+6/)
      expect(aggregateRows).toHaveBeenCalledWith(expect.any(String), { columns: wireCols, rows: [['x', 1]] })
    })
  
    it('selects the whole row when its row number is clicked', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      await userEvent.click(screen.getByText('2', { selector: '[role=rowheader]' }))
      expect(screen.getByText('2', { selector: '[role=rowheader]' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('1', { selector: '[role=rowheader]' })).toHaveAttribute('aria-selected', 'false')
    })

    it('extends the selection by dragging from a row number down and up', () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      const head = (n: string) => screen.getByText(n, { selector: '[role=rowheader]' })
      const rowOf = (n: string) => head(n).closest('[role=row]')!
      fireEvent.mouseDown(head('1'))
      fireEvent.mouseEnter(rowOf('3'))
      for (const n of ['1', '2', '3']) expect(head(n)).toHaveAttribute('aria-selected', 'true')
      fireEvent.mouseEnter(rowOf('2'))
      expect(head('3')).toHaveAttribute('aria-selected', 'false')
      fireEvent.mouseUp(document)
      fireEvent.mouseEnter(rowOf('3'))
      expect(head('3')).toHaveAttribute('aria-selected', 'false')
    })

    it('offers Select row first on a row number and collapses the selection to that row', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      await userEvent.click(screen.getByText('1', { selector: '[role=rowheader]' }))
      fireEvent.click(screen.getByText('3', { selector: '[role=rowheader]' }), { shiftKey: true })
      fireEvent.contextMenu(screen.getByText('2', { selector: '[role=rowheader]' }))
      const items = await screen.findAllByRole('menuitem')
      expect(items[0]).toHaveAccessibleName('Select row')
      await userEvent.click(items[0])
      expect(screen.getByText('2', { selector: '[role=rowheader]' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('1', { selector: '[role=rowheader]' })).toHaveAttribute('aria-selected', 'false')
    })

    it('does not offer Select row when the menu opens on a data cell', async () => {
      render(<ResultsGrid columns={cols} rows={rows} data={{ columns: wireCols, wireRow: wire, source: null }} />)
      fireEvent.contextMenu(screen.getByText('y'))
      await screen.findByRole('menu', { name: 'Row actions' })
      expect(screen.queryByRole('menuitem', { name: 'Select row' })).not.toBeInTheDocument()
    })
  })
})
