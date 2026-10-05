import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportFormatStep } from './ImportFormatStep'
import { importPlan } from '../test/importFixture'

const plan = importPlan()

describe('ImportFormatStep', () => {
  it('shows the detected settings and the raw preview', () => {
    render(<ImportFormatStep format={plan.format} columns={plan.source_columns} preview={plan.preview} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'CSV / TSV' })).toBeChecked()
    expect(screen.getByRole('button', { name: /Delimiter/ })).toHaveTextContent('Semicolon')
    expect(screen.getByRole('table', { name: 'Raw preview' })).toHaveTextContent('a@x.com')
  })
  it('edits the delimiter and the header toggle', async () => {
    const onChange = vi.fn()
    render(<ImportFormatStep format={plan.format} columns={plan.source_columns} preview={plan.preview} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Delimiter/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Tab/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...plan.format, delimiter: '\t' })
    await userEvent.click(screen.getByRole('switch', { name: 'First row is a header' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...plan.format, header: false })
  })
  it('hides CSV controls for JSON and says when nothing could be read', () => {
    render(<ImportFormatStep format={{ ...plan.format, format: 'ndjson', delimiter: '' }} columns={[]} preview={[]} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /Delimiter/ })).not.toBeInTheDocument()
    expect(screen.getByText(/No records could be read/)).toBeInTheDocument()
  })
})
