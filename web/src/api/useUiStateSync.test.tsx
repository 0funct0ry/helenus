import { renderHook, waitFor } from '@testing-library/react'
import { useUiStateSync } from './useUiStateSync'
import { mockApi } from '../test/api'
import { boundTab } from '../test/queriesFixture'
import { useWorkspace } from '../store/workspace'

describe('useUiStateSync saved-query fields', () => {
  beforeEach(() => useWorkspace.setState({ tabs: [], activeId: '', queryStates: {}, consistency: 'LOCAL_QUORUM' }))

  it('restores the binding, savedText and savedVersion', async () => {
    mockApi({
      'GET /p/local/ui-state': { state: { tabs: [boundTab], activeId: 'query-1', queries: { 'query-1': { text: 'edited', keyspace: 'payments', savedText: 'saved', savedVersion: 3 } } } },
    })
    renderHook(() => useUiStateSync(true, 'local'))
    await waitFor(() => expect(useWorkspace.getState().tabs).toHaveLength(1))
    expect(useWorkspace.getState().tabs[0]).toMatchObject({ savedQueryId: 1, queryName: 'reports/daily' })
    expect(useWorkspace.getState().queryStates['query-1']).toMatchObject({ text: 'edited', savedText: 'saved', savedVersion: 3 })
  })
  it('saves savedText and savedVersion with the query text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = mockApi({ 'GET /p/local/ui-state': { state: null }, 'PUT /p/local/ui-state': { status: 204 } })
    renderHook(() => useUiStateSync(true, 'local'))
    await waitFor(() => expect(calls).toHaveLength(1))
    useWorkspace.setState({ tabs: [boundTab], activeId: 'query-1' })
    useWorkspace.getState().patchQuery('query-1', { text: 'now', savedText: 'then', savedVersion: 2 })
    await vi.advanceTimersByTimeAsync(1100)
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.body).toMatchObject({ queries: { 'query-1': { text: 'now', savedText: 'then', savedVersion: 2 } } })
    vi.useRealTimers()
  })
})
