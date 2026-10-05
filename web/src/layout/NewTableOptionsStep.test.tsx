import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTableOptionsStep } from './NewTableOptionsStep'
import { newTableDraft, ttlSeconds } from '../lib/tableDraft'
import type { TableDraft } from '../lib/tableDraft'

let latest: TableDraft
function Harness({ major = 5, errors = {} }: { major?: number; errors?: Record<string, string> }) {
  const [d, setD] = useState(newTableDraft)
  latest = d
  return <NewTableOptionsStep draft={d} onChange={setD} serverMajor={major} errors={errors} />
}
const expand = () => userEvent.click(screen.getByRole('button', { name: 'Defaults are fine for most tables' }))

describe('NewTableOptionsStep', () => {
  it('is collapsed by default', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Defaults are fine for most tables' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()
  })
  it('edits fields and converts the TTL unit', async () => {
    render(<Harness />)
    await expand()
    await userEvent.type(screen.getByLabelText('Comment'), 'hi')
    await userEvent.type(screen.getByLabelText('Default TTL'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'TTL unit' }))
    await userEvent.click(await screen.findByRole('option', { name: 'hours' }))
    expect(latest.options.comment).toBe('hi')
    expect(ttlSeconds(latest.options)).toBe(7200)
  })
  it('offers Unified compaction only on 5.0+', async () => {
    const { unmount } = render(<Harness major={5} />)
    await expand()
    await userEvent.click(screen.getByRole('button', { name: 'Compaction' }))
    expect(await screen.findByRole('option', { name: 'UnifiedCompactionStrategy' })).toBeInTheDocument()
    unmount()
    render(<Harness major={4} />)
    await expand()
    await userEvent.click(screen.getByRole('button', { name: 'Compaction' }))
    await screen.findByRole('option', { name: 'LeveledCompactionStrategy' })
    expect(screen.queryByRole('option', { name: 'UnifiedCompactionStrategy' })).not.toBeInTheDocument()
  })
  it('resets to defaults and shows errors', async () => {
    render(<Harness errors={{ gc_grace_seconds: 'gc_grace_seconds must be at least 0' }} />)
    await expand()
    await userEvent.type(screen.getByLabelText('gc_grace_seconds'), '5')
    expect(screen.getByText('gc_grace_seconds must be at least 0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(latest.options.gcGrace).toBe('')
  })
})
