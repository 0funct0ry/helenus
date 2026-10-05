import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewViewColumnsStep } from './NewViewColumnsStep'
import { newViewDraft } from '../lib/viewDraft'
import type { ViewDraft } from '../lib/viewDraft'
import type { Table } from '../lib/schemaModel'

const col = (name: string, kind: Table['columns'][number]['kind'], position?: number) => ({ name, type: 'text', kind, position })
const orders: Table = { name: 'orders', keyspace: 'shop', options: {}, indexes: [], views: [], columns: [col('id', 'partition', 1), col('status', 'regular'), col('note', 'static')] }
const plain: Table = { ...orders, name: 'plain', columns: [col('id', 'partition', 1), col('status', 'regular')] }

let latest: ViewDraft
function Harness({ errors = {} }: { errors?: Record<string, string> }) {
  const [d, setD] = useState(() => newViewDraft())
  latest = d
  return <NewViewColumnsStep draft={d} onChange={setD} tables={[orders, plain]} errors={errors} />
}

describe('NewViewColumnsStep', () => {
  it('shows columns only after a base table is chosen and pre-places its keys', async () => {
    render(<Harness />)
    expect(screen.queryByRole('region', { name: 'Columns' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Base table' }))
    await userEvent.click(await screen.findByRole('option', { name: 'plain' }))
    expect(latest.baseTable).toBe('plain')
    expect(latest.partitionKey).toEqual(['id'])
    expect(screen.getByRole('switch', { name: 'All columns' })).toBeEnabled()
  })
  it('disables All columns and static columns when the base has static columns', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Base table' }))
    await userEvent.click(await screen.findByRole('option', { name: 'orders' }))
    expect(screen.getByRole('switch', { name: 'All columns' })).toBeDisabled()
    expect(screen.getByLabelText('Select note')).toBeDisabled()
    expect(screen.getByLabelText('Select id')).toBeDisabled()
    expect(screen.getByLabelText('Select id')).toBeChecked()
  })
  it('toggles a regular column and shows errors', async () => {
    render(<Harness errors={{ name: 'View name is required' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Base table' }))
    await userEvent.click(await screen.findByRole('option', { name: 'orders' }))
    await userEvent.click(screen.getByLabelText('Select status'))
    expect(latest.columns).not.toContain('status')
    expect(screen.getByText('View name is required')).toBeInTheDocument()
  })
})
