import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportFormatOptions } from './ExportFormatOptions'
import { DEFAULT_EXPORT_OPTIONS } from '../lib/exportModel'

describe('ExportFormatOptions', () => {
  it('shows the CSV options and reports edits', async () => {
    const onChange = vi.fn()
    render(<ExportFormatOptions format="csv" options={DEFAULT_EXPORT_OPTIONS} onChange={onChange} />)
    expect(screen.getByRole('switch', { name: 'Header row' })).toBeChecked()
    expect(screen.getByLabelText('NULL text')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Header row' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EXPORT_OPTIONS, header: false })
  })
  it('picks a delimiter from the menu', async () => {
    const onChange = vi.fn()
    render(<ExportFormatOptions format="csv" options={DEFAULT_EXPORT_OPTIONS} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Delimiter/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Semicolon ;' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EXPORT_OPTIONS, delimiter: ';' })
  })
  it('shows only the header toggle for Excel and nothing for JSON', () => {
    const { rerender } = render(<ExportFormatOptions format="excel" options={DEFAULT_EXPORT_OPTIONS} onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: 'Header row' })).toBeInTheDocument()
    expect(screen.queryByLabelText('NULL text')).not.toBeInTheDocument()
    rerender(<ExportFormatOptions format="json" options={DEFAULT_EXPORT_OPTIONS} onChange={() => {}} />)
    expect(screen.getByText('This format has no options.')).toBeInTheDocument()
  })
})
