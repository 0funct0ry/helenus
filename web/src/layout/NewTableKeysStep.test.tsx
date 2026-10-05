import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTableKeysStep } from './NewTableKeysStep'
import { newColumn, newTableDraft } from '../lib/tableDraft'
import type { TableDraft } from '../lib/tableDraft'

let latest: TableDraft
const start = (): TableDraft => ({ ...newTableDraft(), columns: [newColumn('a', 'int'), newColumn('b', 'text'), newColumn('c', 'text')] })
function Harness({ errors = {} }: { errors?: Record<string, string> }) {
  const [d, setD] = useState(start)
  latest = d
  return <NewTableKeysStep draft={d} onChange={setD} errors={errors} />
}
const add = async (section: string, col: string) => {
  await userEvent.click(screen.getByRole('button', { name: `Add to ${section}` }))
  await userEvent.click(await screen.findByRole('option', { name: col }))
}

describe('NewTableKeysStep', () => {
  it('builds an ordered partition key and clustering list', async () => {
    render(<Harness />)
    await add('Partition key', 'a')
    await add('Partition key', 'b')
    await add('Clustering columns', 'c')
    expect(latest.partitionKey).toHaveLength(2)
    expect(latest.clustering).toHaveLength(1)
    expect(screen.getByLabelText('Partition key 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Clustering key 1 ASC')).toBeInTheDocument()
  })
  it('allows a column in only one place', async () => {
    render(<Harness />)
    await add('Partition key', 'a')
    await userEvent.click(screen.getByRole('button', { name: 'Add to Clustering columns' }))
    expect(screen.queryByRole('option', { name: 'a' })).not.toBeInTheDocument()
  })
  it('reorders with buttons and switches order', async () => {
    render(<Harness />)
    await add('Partition key', 'a')
    await add('Partition key', 'b')
    await userEvent.click(screen.getByRole('button', { name: 'Move b up in Partition key' }))
    expect(latest.columns.find((c) => c.id === latest.partitionKey[0])?.name).toBe('b')
    await add('Clustering columns', 'c')
    await userEvent.click(screen.getByRole('radio', { name: 'DESC' }))
    expect(latest.clustering[0].order).toBe('DESC')
    expect(screen.getByLabelText('Clustering key 1 DESC')).toBeInTheDocument()
  })
  it('removes a key column and shows errors', async () => {
    render(<Harness errors={{ partition_key: 'Choose at least one partition key column' }} />)
    expect(screen.getByText('Choose at least one partition key column')).toBeInTheDocument()
    await add('Partition key', 'a')
    await userEvent.click(screen.getByRole('button', { name: 'Remove a from Partition key' }))
    expect(latest.partitionKey).toEqual([])
  })
})
