import { abortInflight, beginInflight, endInflight } from './inflight'

describe('inflight', () => {
  it('aborts the previous request when a new one begins', () => {
    const a = beginInflight('t')
    const b = beginInflight('t')
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(false)
    abortInflight('t')
    expect(b.aborted).toBe(true)
  })
  it('does not untrack a newer request when an older one ends', () => {
    const a = beginInflight('u')
    const b = beginInflight('u')
    endInflight('u', a)
    abortInflight('u')
    expect(b.aborted).toBe(true)
  })
})
