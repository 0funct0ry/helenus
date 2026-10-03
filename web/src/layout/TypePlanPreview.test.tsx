import { render, screen } from '@testing-library/react'
import { TypePlanPreview } from './TypePlanPreview'

describe('TypePlanPreview', () => {
  it('shows the statement and notes', () => {
    render(<TypePlanPreview pending={false} plan={{ statement: 'DROP TYPE a.b;', errors: [], notes: ['Field x is frozen'], dependents: [] }} />)
    expect(screen.getByText('DROP TYPE a.b;')).toBeInTheDocument()
    expect(screen.getByText('Field x is frozen')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('shows errors instead of a statement', () => {
    render(<TypePlanPreview pending={false} plan={{ statement: '', errors: ['type name is required'], notes: [], dependents: [] }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('type name is required')
    expect(screen.getByText(/fix the errors/)).toBeInTheDocument()
  })
  it('says it is building while pending', () => {
    render(<TypePlanPreview pending plan={{ statement: '', errors: [], notes: [], dependents: [] }} />)
    expect(screen.getByText('Building…')).toBeInTheDocument()
  })
})
