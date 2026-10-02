import { DEFAULT_QUERY_TEXT, newQueryState, useWorkspace } from './workspace'
import * as inflight from '../api/inflight'

describe('query tab state', () => {
  beforeEach(() => useWorkspace.setState({ tabs: [], activeId: '', queryCount: 0, queryStates: {}, consistency: 'LOCAL_QUORUM' }))

  it('creates state for "New query here" with the keyspace and CQL', () => {
    useWorkspace.getState().newQuery({ keyspace: 'payments', cql: 'SELECT * FROM payments.merchants LIMIT 100;' })
    const id = useWorkspace.getState().activeId
    expect(useWorkspace.getState().queryStates[id]).toMatchObject({ keyspace: 'payments', text: 'SELECT * FROM payments.merchants LIMIT 100;', pageSize: 100, consistency: 'LOCAL_QUORUM' })
  })
  it('starts blank queries with the hint text and the current consistency', () => {
    useWorkspace.setState({ consistency: 'ONE' })
    useWorkspace.getState().newQuery()
    expect(useWorkspace.getState().queryStates[useWorkspace.getState().activeId]).toMatchObject({ text: DEFAULT_QUERY_TEXT, consistency: 'ONE' })
  })
  it('patches, creating state when missing', () => {
    useWorkspace.getState().patchQuery('x', { trace: true })
    expect(useWorkspace.getState().queryStates.x).toMatchObject({ trace: true, allowFiltering: false })
  })
  it('drops state and aborts the request when a tab closes', () => {
    const spy = vi.spyOn(inflight, 'abortInflight')
    useWorkspace.getState().newQuery()
    const id = useWorkspace.getState().activeId
    useWorkspace.getState().close(id)
    expect(spy).toHaveBeenCalledWith(id)
    expect(useWorkspace.getState().queryStates[id]).toBeUndefined()
  })
  it('newQueryState applies overrides', () => {
    expect(newQueryState({ pageSize: 50 }, 'ALL')).toMatchObject({ pageSize: 50, consistency: 'ALL', results: [] })
  })
})
