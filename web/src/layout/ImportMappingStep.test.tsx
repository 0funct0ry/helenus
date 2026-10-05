import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportMappingStep } from './ImportMappingStep'
import { importColumns, importPlan } from '../test/importFixture'

const plan = importPlan()

describe('ImportMappingStep', () => {
  it('shows each target with its type, source and confidence chip', () => {
    render(<ImportMappingStep columns={plan.columns} sourceColumns={plan.source_columns} errors={[]} onChange={() => {}} />)
    const row = screen.getByText('user_id').closest('tr')!
    expect(within(row).getByText('uuid')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Source for user_id/ })).toHaveTextContent('UserId')
    expect(screen.getByTestId('confidence-user_id')).toHaveTextContent('normalized')
  })
  it('lists failure counts and samples', async () => {
    render(<ImportMappingStep columns={plan.columns} sourceColumns={plan.source_columns} errors={[]} onChange={() => {}} />)
    await userEvent.click(screen.getByText(/2 of the checked rows fail/))
    expect(screen.getByText(/line 7: “nope”/)).toBeInTheDocument()
  })
  it('lets non-key columns be skipped and returns the whole mapping', async () => {
    const onChange = vi.fn()
    render(<ImportMappingStep columns={plan.columns} sourceColumns={plan.source_columns} errors={[]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Source for email/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Skip' }))
    expect(onChange).toHaveBeenCalledWith([
      { target: 'user_id', source: 'UserId' },
      { target: 'email', source: '' },
      { target: 'created_at', source: 'createdAt' },
    ])
  })
  it('offers no Skip for key columns and shows blocking errors', async () => {
    const cols = importColumns.map((c) => (c.target === 'user_id' ? { ...c, source: '', confidence: '' as const } : c))
    render(<ImportMappingStep columns={cols} sourceColumns={plan.source_columns} errors={['Map a source column to user_id']} onChange={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Map a source column to user_id')
    await userEvent.click(screen.getByRole('button', { name: /Source for user_id/ }))
    expect(screen.queryByRole('option', { name: 'Skip' })).not.toBeInTheDocument()
  })
})
