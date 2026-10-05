import { screen } from '@testing-library/react'
import { mockApi, renderWithClient } from '../test/api'
import { TableAdviceView } from './TableAdviceView'

describe('TableAdviceView', () => {
  beforeEach(() => localStorage.clear())
  it('lists findings for the table', async () => {
    const calls = mockApi({
      'GET /p/local/advise?keyspace=shop&table=readings': { findings: [{ id: 'A002', severity: 'warning', message: 'Partitions grow without bound', help_url: '/x#a002', keyspace: 'shop', table: 'readings' }] },
    })
    renderWithClient(<TableAdviceView profile="local" keyspace="shop" table="readings" />)
    expect(await screen.findByRole('note')).toHaveTextContent('Partitions grow without bound')
    expect(calls).toHaveLength(1)
  })
})
