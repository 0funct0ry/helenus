/** Pure helper behind the tab header menu (SPEC §9.1): which tabs a "Close ..." item closes. */

export type TabCloseScope = 'all' | 'others' | 'left' | 'right'

interface TabLike {
  id: string
  closable?: boolean
}

/**
 * Ids to close for `scope` relative to the right-clicked tab, in tab order. Non-closable tabs are
 * skipped. The target itself is only included for `all`. An unknown target yields nothing except for `all`.
 */
export function tabsToClose(tabs: TabLike[], targetId: string, scope: TabCloseScope): string[] {
  const at = tabs.findIndex((t) => t.id === targetId)
  if (scope !== 'all' && at < 0) return []
  return tabs
    .filter((t, i) => {
      if (t.closable === false) return false
      switch (scope) {
        case 'all':
          return true
        case 'others':
          return i !== at
        case 'left':
          return i < at
        case 'right':
          return i > at
      }
    })
    .map((t) => t.id)
}
