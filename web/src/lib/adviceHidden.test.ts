import { hiddenAdvice, hideAdvice, parseAdviceNote, resetAdvice } from './adviceHidden'

describe('adviceHidden', () => {
  beforeEach(() => localStorage.clear())
  it('hides per profile and resets', () => {
    hideAdvice('a', 'A002')
    expect(hiddenAdvice('a').has('A002')).toBe(true)
    expect(hiddenAdvice('b').size).toBe(0)
    resetAdvice('a')
    expect(hiddenAdvice('a').size).toBe(0)
  })
  it('survives corrupt storage', () => {
    localStorage.setItem('helenus.hiddenAdvice.a', '{oops')
    expect(hiddenAdvice('a').size).toBe(0)
  })
  it('parses advisor notes only', () => {
    expect(parseAdviceNote('A002: Partitions grow')).toEqual({ id: 'A002', message: 'Partitions grow' })
    expect(parseAdviceNote('Field x is frozen')).toBeNull()
  })
})
