import { tabsToClose } from './tabMenu'

const t = (id: string, closable?: boolean) => ({ id, closable })
const four = [t('a'), t('b'), t('c'), t('d')]

describe('tabsToClose', () => {
  it('handles each scope for the first, middle and last tab', () => {
    expect(tabsToClose(four, 'a', 'all')).toEqual(['a', 'b', 'c', 'd'])
    expect(tabsToClose(four, 'a', 'others')).toEqual(['b', 'c', 'd'])
    expect(tabsToClose(four, 'a', 'left')).toEqual([])
    expect(tabsToClose(four, 'a', 'right')).toEqual(['b', 'c', 'd'])
    expect(tabsToClose(four, 'b', 'others')).toEqual(['a', 'c', 'd'])
    expect(tabsToClose(four, 'b', 'left')).toEqual(['a'])
    expect(tabsToClose(four, 'b', 'right')).toEqual(['c', 'd'])
    expect(tabsToClose(four, 'd', 'left')).toEqual(['a', 'b', 'c'])
    expect(tabsToClose(four, 'd', 'right')).toEqual([])
  })
  it('handles a single tab', () => {
    const one = [t('a')]
    expect(tabsToClose(one, 'a', 'all')).toEqual(['a'])
    expect(tabsToClose(one, 'a', 'others')).toEqual([])
    expect(tabsToClose(one, 'a', 'left')).toEqual([])
    expect(tabsToClose(one, 'a', 'right')).toEqual([])
  })
  it('skips non-closable tabs', () => {
    const tabs = [t('a', false), t('b'), t('c', false), t('d')]
    expect(tabsToClose(tabs, 'b', 'all')).toEqual(['b', 'd'])
    expect(tabsToClose(tabs, 'b', 'others')).toEqual(['d'])
    expect(tabsToClose(tabs, 'b', 'left')).toEqual([])
    expect(tabsToClose(tabs, 'b', 'right')).toEqual(['d'])
  })
  it('handles empty and unknown cases', () => {
    expect(tabsToClose([], 'a', 'all')).toEqual([])
    expect(tabsToClose(four, 'zz', 'others')).toEqual([])
    expect(tabsToClose(four, 'zz', 'left')).toEqual([])
    expect(tabsToClose(four, 'zz', 'right')).toEqual([])
    expect(tabsToClose(four, 'zz', 'all')).toEqual(['a', 'b', 'c', 'd'])
  })
})
