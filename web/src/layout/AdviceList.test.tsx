import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdviceFinding } from '../api/types'
import { AdviceList } from './AdviceList'

const f: AdviceFinding = { id: 'A002', severity: 'warning', message: 'Partitions grow', help_url: '/x#a002', keyspace: 'k', table: 't' }

describe('AdviceList', () => {
  beforeEach(() => localStorage.clear())
  it('hides a rule and brings it back', async () => {
    render(<AdviceList profile="p" findings={[f]} showTable />)
    expect(screen.getByRole('note')).toHaveTextContent('t: Partitions grow')
    await userEvent.click(screen.getByRole('button', { name: 'Hide this advice' }))
    expect(screen.getByText('No data-model advice.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 hidden' }))
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})
