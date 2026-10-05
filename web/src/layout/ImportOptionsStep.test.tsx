import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportOptionsStep } from './ImportOptionsStep'
import { defaultImportOptions } from '../lib/importModel'

describe('ImportOptionsStep', () => {
  it('edits options', async () => {
    const onChange = vi.fn()
    render(<ImportOptionsStep options={defaultImportOptions} onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch', { name: 'IF NOT EXISTS' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultImportOptions, if_not_exists: true })
    await userEvent.type(screen.getByLabelText('Batch size'), '0')
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultImportOptions, batch_size: 10 })
  })
  it('does not offer ANY and warns about IF NOT EXISTS', async () => {
    render(<ImportOptionsStep options={{ ...defaultImportOptions, if_not_exists: true }} onChange={() => {}} />)
    expect(screen.getByText(/much slower/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Consistency/ }))
    expect(screen.queryByRole('option', { name: 'ANY' })).not.toBeInTheDocument()
  })
  it('flags out-of-range values', () => {
    render(<ImportOptionsStep options={{ ...defaultImportOptions, concurrency: 65, batch_size: 101 }} onChange={() => {}} />)
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Use 1 to 64.', 'Use 1 to 100.'])
  })
})
