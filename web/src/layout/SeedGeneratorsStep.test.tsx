import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@testing-library/react'
import { SeedGeneratorsStep } from './SeedGeneratorsStep'
import { seedColumns, seedConfig, seedRows } from '../test/seedFixture'

function setup(errors: { field: string; message: string }[] = []) {
  const onChange = vi.fn()
  render(<SeedGeneratorsStep columns={seedColumns} config={seedConfig} errors={errors} rows={seedRows} udtFields={() => []} onChange={onChange} />)
  return onChange
}

describe('SeedGeneratorsStep', () => {
  it('shows one section per column with generator, type and live samples', () => {
    setup()
    const email = screen.getByRole('region', { name: 'Column email' })
    expect(within(email).getByRole('button', { name: /email generator/ })).toHaveTextContent('Fake data')
    expect(within(email).getByText(/ada.lovelace0@example.com · ada.lovelace1/)).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(3)
  })
  it('offers only compatible generators and never Null for key columns', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /id generator/ }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Constant', 'UUID (v4)'])
  })
  it('changes the generator and keeps the null percent', async () => {
    const onChange = setup()
    await userEvent.click(screen.getByRole('button', { name: /email generator/ }))
    await userEvent.click(screen.getByRole('option', { name: 'Regex' }))
    expect(onChange.mock.calls[0][0].columns.email).toEqual({ type: 'text', gen: 'regex', null_percent: undefined })
  })
  it('sets null percent only on non-key columns', () => {
    const onChange = setup()
    expect(screen.queryByLabelText('id null percent')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('email null percent'), { target: { value: '25' } })
    expect(onChange.mock.calls[0][0].columns.email.null_percent).toBe(25)
  })
  it('shows server errors under the field they belong to', () => {
    setup([{ field: 'columns.email.params.category', message: 'unknown category "x"' }])
    expect(screen.getByRole('alert')).toHaveTextContent('unknown category')
  })
})
