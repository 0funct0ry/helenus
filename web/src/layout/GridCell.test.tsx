import { render, screen } from '@testing-library/react'
import { GridCell } from './GridCell'
import type { Column } from '../mocks/types'

const col = (type: string, kind: Column['kind'] = 'regular'): Column => ({ name: 'c', type, kind })

describe('GridCell', () => {
  it('shows null as a dim italic word', () => {
    render(<GridCell column={col('text')} value={null} />)
    expect(screen.getByText('null')).toHaveClass('italic')
  })
  it('colours values by type family', () => {
    const { rerender } = render(<GridCell column={col('int')} value={5} />)
    expect(screen.getByText('5')).toHaveClass('text-syn-num')
    rerender(<GridCell column={col('set<text>')} value="{'a'}" />)
    expect(screen.getByText("{'a'}")).toHaveClass('text-syn-const')
    rerender(<GridCell column={col('text')} value="hi" />)
    expect(screen.getByText('hi')).toHaveClass('text-syn-str')
  })
  it('mutes key columns', () => {
    render(<GridCell column={col('uuid', 'partition')} value="abc" />)
    expect(screen.getByText('abc')).toHaveClass('text-muted')
  })
  it('puts the embedded time of a timeuuid in its tooltip', () => {
    render(<GridCell column={col('timeuuid', 'clustering')} value="3f1a2b10-9d3c-11ef-8a6e-0242ac120002" />)
    expect(screen.getByText('3f1a2b10-9d3c-11ef-8a6e-0242ac120002')).toHaveAttribute('title', expect.stringMatching(/^2024-/))
  })
})
