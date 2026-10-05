import { useState } from 'react'
import { History, Network } from 'lucide-react'
import { SchemaTree } from './SchemaTree'
import { SchemaChangesPanel } from './SchemaChangesPanel'
import { Tabs } from '../ui/Tabs'
import { cn } from '../lib/cn'

type DockTab = 'schema' | 'changes'

/**
 * The left dock: a tab strip switching between the schema tree and the "Schema changes" history panel.
 * The tree stays mounted while hidden so its filter and expansion state survive a tab switch.
 */
export function LeftDock() {
  const [tab, setTab] = useState<DockTab>('schema')
  return (
    <div className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line2 px-2 py-1.5">
        <Tabs
          aria-label="Left dock"
          value={tab}
          onChange={(id) => setTab(id as DockTab)}
          items={[
            { id: 'schema', label: <><Network size={13} aria-hidden /> Schema</> },
            { id: 'changes', label: <><History size={13} aria-hidden /> Schema changes</> },
          ]}
        />
      </div>
      <div className={cn('min-h-0 flex-1 flex-col [&>aside]:min-h-0 [&>aside]:flex-1 [&>aside]:border-r-0', tab === 'schema' ? 'flex' : 'hidden')}>
        <SchemaTree />
      </div>
      {tab === 'changes' && <SchemaChangesPanel />}
    </div>
  )
}
