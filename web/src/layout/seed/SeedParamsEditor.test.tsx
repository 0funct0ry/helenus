import { render, screen } from '@testing-library/react'
import { SeedParamsEditor } from './SeedParamsEditor'

const base = { type: { name: 'text' }, errors: {}, onChange: () => {} }

describe('SeedParamsEditor', () => {
  it('renders the editor of the chosen generator', () => {
    render(<SeedParamsEditor {...base} spec={{ gen: 'regex' }} />)
    expect(screen.getByLabelText('Pattern')).toBeInTheDocument()
  })
  it('renders nothing for generators without parameters', () => {
    const { container } = render(<SeedParamsEditor {...base} spec={{ gen: 'uuid' }} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('maps range-like generators to their editors', () => {
    const { rerender } = render(<SeedParamsEditor {...base} spec={{ gen: 'int_range' }} />)
    expect(screen.getByLabelText('Min')).toBeInTheDocument()
    rerender(<SeedParamsEditor {...base} spec={{ gen: 'decimal_range' }} />)
    expect(screen.getByLabelText('Decimals')).toBeInTheDocument()
    rerender(<SeedParamsEditor {...base} spec={{ gen: 'timeuuid' }} />)
    expect(screen.getByLabelText('From')).toBeInTheDocument()
  })
})
