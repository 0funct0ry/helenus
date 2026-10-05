import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('shows advice as an amber note that can be hidden, and the explanation', async () => {
    localStorage.clear()
    render(<TypePlanPreview pending={false} plan={{ statement: 'CREATE TABLE a.b (id int PRIMARY KEY);', errors: [], notes: ['A002: Partitions grow without bound'], explain: ['Creates table b.'], dependents: [] }} />)
    expect(screen.getByRole('note')).toHaveTextContent('Partitions grow without bound')
    await userEvent.click(screen.getByRole('button', { name: /what this does/i }))
    expect(screen.getByText('Creates table b.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide this advice' }))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
