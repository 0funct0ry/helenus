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

describe('closeMany', () => {
  const tab = (id: string) => ({ id, kind: 'query' as const, title: id, keyspace: '', object: '', closable: true })
  const item = { id: 'i', kind: 'insert' } as never
  beforeEach(() =>
    useWorkspace.setState({
      tabs: ['a', 'b', 'c', 'd'].map(tab),
      activeId: 'c',
      queryCount: 4,
      queryStates: { a: newQueryState(), b: newQueryState() },
      columnViews: { a: {} as never },
      edits: { a: [item], c: [item] },
      editErrors: { a: { i: 'x' } },
    }),
  )
  const ids = () => useWorkspace.getState().tabs.map((t) => t.id)

  it('clears per-tab state, aborts requests and ignores unknown ids', () => {
    const spy = vi.spyOn(inflight, 'abortInflight')
    useWorkspace.getState().closeMany(['a', 'b', 'zz'])
    const s = useWorkspace.getState()
    expect(ids()).toEqual(['c', 'd'])
    expect(spy).toHaveBeenCalledWith('a')
    expect(spy).toHaveBeenCalledWith('b')
    expect(spy).not.toHaveBeenCalledWith('zz')
    expect(s.queryStates).toEqual({})
    expect(s.columnViews).toEqual({})
    expect(s.edits).toEqual({ c: [item] })
    expect(s.editErrors).toEqual({})
    expect(s.queryCount).toBe(4)
  })
  it('keeps the active tab when it survives', () => {
    useWorkspace.getState().closeMany(['a'], 'b')
    expect(useWorkspace.getState().activeId).toBe('c')
  })
  it('activates the target when the active tab is closed', () => {
    useWorkspace.getState().closeMany(['a', 'c', 'd'], 'b')
    expect(useWorkspace.getState().activeId).toBe('b')
  })
  it('leaves no active tab after closing all', () => {
    useWorkspace.getState().closeMany(['a', 'b', 'c', 'd'])
    expect(useWorkspace.getState()).toMatchObject({ tabs: [], activeId: '' })
  })
  it('updates state once', () => {
    let n = 0
    const un = useWorkspace.subscribe(() => n++)
    useWorkspace.getState().closeMany(['a', 'b', 'd'], 'c')
    un()
    expect(n).toBe(1)
  })
  it('close(id) still picks the neighbour', () => {
    useWorkspace.getState().close('c')
    expect(useWorkspace.getState().activeId).toBe('d')
  })
})
