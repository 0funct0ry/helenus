import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SeedGeneratorEditor } from './SeedGeneratorEditor'

describe('SeedGeneratorEditor', () => {
  it('lists only generators that fit the type, plus Default', async () => {
    render(<SeedGeneratorEditor label="Element" type={{ name: 'boolean' }} spec={undefined} errors={{}} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Element generator/ }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Default', 'Constant', 'Null', 'Boolean', 'Choice'])
  })
  it('reports the chosen generator, or undefined for Default', async () => {
    const onChange = vi.fn()
    render(<SeedGeneratorEditor label="Element" type={{ name: 'int' }} spec={{ gen: 'int_range' }} errors={{}} onChange={onChange} />)
    expect(screen.getByLabelText('Min')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Element generator/ }))
    await userEvent.click(screen.getByRole('option', { name: 'Sequence' }))
    expect(onChange).toHaveBeenCalledWith({ gen: 'sequence' })
    await userEvent.click(screen.getByRole('button', { name: /Element generator/ }))
    await userEvent.click(screen.getByRole('option', { name: 'Default' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
