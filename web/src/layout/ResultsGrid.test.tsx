import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultsGrid } from './ResultsGrid'
import { dataColumns, dataRows } from '../mocks/rows'

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
  it('copies a cell, a row as JSON and a selection as TSV', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const cols = [{ name: 'a', type: 'text', kind: 'regular' as const }, { name: 'b', type: 'int', kind: 'regular' as const }]
    const rows = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }]
    render(<ResultsGrid columns={cols} rows={rows} rowJson={(i) => `json-${i}`} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
    await userEvent.click(screen.getByText('x'))
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy cell' }))
    expect(writeText).toHaveBeenLastCalledWith('x')
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy row as JSON' }))
    expect(writeText).toHaveBeenLastCalledWith('json-0')
    await userEvent.click(screen.getByText('1', { selector: '[role=rowheader]' }))
    fireEvent.click(screen.getByText('2', { selector: '[role=rowheader]' }), { shiftKey: true })
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy selection as TSV' }))
    expect(writeText).toHaveBeenLastCalledWith('a\tb\nx\t1\ny\t2')
  })
})
