import { render, screen, within } from '@testing-library/react'
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
})
