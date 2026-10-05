import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewViewKeysStep } from './NewViewKeysStep'
import { newViewDraft } from '../lib/viewDraft'
import type { ViewDraft } from '../lib/viewDraft'
import type { Table } from '../lib/schemaModel'

const col = (name: string, kind: Table['columns'][number]['kind'], position?: number, order?: 'ASC' | 'DESC') => ({ name, type: 'text', kind, position, order })
const base: Table = {
  name: 'orders', keyspace: 'shop', options: {}, indexes: [], views: [],
  columns: [col('merchant', 'partition', 1), col('id', 'clustering', 1, 'DESC'), col('status', 'regular'), col('note', 'static')],
}

let latest: ViewDraft
function Harness({ errors = {} }: { errors?: Record<string, string> }) {
  const [d, setD] = useState(() => newViewDraft(base))
  latest = d
  return <NewViewKeysStep draft={d} onChange={setD} base={base} errors={errors} />
}

describe('NewViewKeysStep', () => {
  it('pre-places base keys, locked from removal', () => {
    render(<Harness />)
    expect(screen.getByRole('img', { name: 'merchant is locked' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'id is locked' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove merchant/ })).not.toBeInTheDocument()
    expect(latest.clustering).toEqual([{ column: 'id', order: 'DESC' }])
  })
  it('adds and removes an extra column, never offering static columns', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Add to Partition key' }))
    expect(screen.queryByRole('option', { name: 'note' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: 'status' }))
    expect(latest.partitionKey).toEqual(['merchant', 'status'])
    await userEvent.click(screen.getByRole('button', { name: 'Remove status from Partition key' }))
    expect(latest.partitionKey).toEqual(['merchant'])
  })
  it('switches order and edits the extra restriction', async () => {
    render(<Harness errors={{ extra_where: "The restriction cannot contain ';'" }} />)
    await userEvent.click(screen.getByRole('radio', { name: 'ASC' }))
    expect(latest.clustering[0].order).toBe('ASC')
    await userEvent.type(screen.getByLabelText('Extra WHERE restriction (optional)'), 'a=1')
    expect(latest.extraWhere).toBe('a=1')
    expect(screen.getByText("The restriction cannot contain ';'")).toBeInTheDocument()
  })
})
