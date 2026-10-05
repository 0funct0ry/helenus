import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTableColumnsStep } from './NewTableColumnsStep'
import { newTableDraft } from '../lib/tableDraft'
import type { TableDraft } from '../lib/tableDraft'

let latest: TableDraft
function Harness({ errors = {} }: { errors?: Record<string, string> }) {
  const [d, setD] = useState(newTableDraft)
  latest = d
  return <NewTableColumnsStep draft={d} onChange={setD} udts={[]} errors={errors} />
}

describe('NewTableColumnsStep', () => {
  it('autofocuses the table name and starts with one column', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Table name')).toHaveFocus()
    expect(screen.getAllByLabelText(/Column \d name/)).toHaveLength(1)
  })
  it('adds, names and removes columns', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(screen.getAllByLabelText(/Column \d name/)).toHaveLength(2)
    await userEvent.type(screen.getByLabelText('Column 2 name'), 'b')
    await userEvent.click(screen.getByRole('button', { name: 'Remove column 1' }))
    expect(latest.columns.map((c) => c.name)).toEqual(['b'])
  })
  it('quick-adds id uuid, replacing a blank first row', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'id uuid' }))
    expect(latest.columns.map((c) => [c.name, c.type.base])).toEqual([['id', 'uuid']])
  })
  it('shows errors passed in', () => {
    render(<Harness errors={{ name: 'Table name is required', 'columns.0.name': 'Column name is required' }} />)
    expect(screen.getByText('Table name is required')).toBeInTheDocument()
    expect(screen.getByText('Column name is required')).toBeInTheDocument()
  })
  it('toggles IF NOT EXISTS', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('switch', { name: "Create only if it doesn't exist" }))
    expect(latest.ifNotExists).toBe(true)
  })
})
