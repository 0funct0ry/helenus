import { useState } from 'react'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { TypeBadge } from '../ui/TypeBadge'
import { CodeEditor } from './CodeEditor'
import { DependencyPanel } from './DependencyPanel'
import { DropFunctionDialog } from './DropFunctionDialog'
import { FunctionEditor } from './FunctionEditor'
import { FunctionTestPanel } from './FunctionTestPanel'
import { useCluster, useDdl, useRefreshSchema, useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import { useToasts } from '../store/toast'
import type { WorkspaceTab } from '../store/workspace'

export interface FunctionViewProps {
  tab: WorkspaceTab
}

/**
 * Function tab body for one overload (the tab's object is its signature): arguments, return type, language,
 * null behaviour, the read-only body, a Test panel, dependencies and DDL. "Edit" opens the editor in replace
 * mode and "Drop function" the confirmation dialog; system keyspaces offer neither.
 */
export function FunctionView({ tab }: FunctionViewProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const close = useWorkspace((s) => s.close)
  const { data: keyspaces } = useSchema(profileId, connected)
  const refresh = useRefreshSchema(profileId)
  const pushToast = useToasts((s) => s.push)
  const ks = keyspaces?.find((k) => k.name === tab.keyspace)
  const fn = ks?.functions.find((f) => f.signature === tab.object)
  const [dialog, setDialog] = useState<'edit' | 'drop' | null>(null)
  const { data: described } = useDdl(profileId, tab.keyspace, 'function', tab.object, !!fn)
  const { data: cluster } = useCluster(profileId, connected)
  if (!fn) return <p className="p-6 text-muted">Function not found.</p>
  const serverMajor = parseInt(cluster?.release_version ?? '0', 10) || 0
  const ddl = (described ?? '').trim()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line2 px-2.5 py-[5px]">
        <span className="font-medium">
          {fn.keyspace}.{fn.signature}
        </span>
        <Badge tone="udt">function</Badge>
        <Badge>{fn.language}</Badge>
        <div className="flex-1" />
        <Button variant="ghost" icon={<Copy size={14} />} disabled={!ddl} onClick={() => void navigator.clipboard?.writeText(ddl)}>
          Copy DDL
        </Button>
        {!ks?.system && (
          <>
            <Button icon={<Pencil size={14} />} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setDialog('drop')}>
              Drop function…
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px] md:grid md:grid-cols-[1.3fr_1fr] md:gap-7">
          <div>
            <h3 className="mb-2 mt-0 text-[13px] font-semibold">Signature</h3>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {fn.argTypes.map((t, i) => (
                  <tr key={i}>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{fn.argNames[i]}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5">
                      <TypeBadge type={t} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-2.5 py-1.5 text-muted">returns</td>
                  <td className="px-2.5 py-1.5">
                    <TypeBadge type={fn.returnType} />
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mb-0 mt-2 text-[12.5px] text-muted">{fn.calledOnNull ? 'Called on null input' : 'Returns null on null input'}</p>
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Body</h3>
            <CodeEditor value={fn.body} readOnly aria-label="Function body" />
          </div>
          <div>
            <h3 className="mb-2 mt-0 text-[13px] font-semibold max-md:mt-[22px]">Test</h3>
            <FunctionTestPanel key={fn.signature} fn={fn} />
            {ddl && (
              <>
                <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">DDL</h3>
                <pre className="m-0 whitespace-pre-wrap rounded-md border border-line2 bg-editor p-3.5 font-mono text-[12.5px] leading-5">{ddl}</pre>
              </>
            )}
          </div>
          <div className="md:col-span-2">
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Dependencies</h3>
            <DependencyPanel kind="function" keyspace={fn.keyspace} name={fn.name} signature={fn.signature} />
          </div>
        </div>
      </div>
      {dialog === 'edit' && (
        <FunctionEditor
          keyspace={fn.keyspace}
          existing={fn}
          serverMajor={serverMajor}
          onSaved={() => {
            refresh.mutate()
            pushToast(`Function ${fn.name} changed`)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'drop' && (
        <DropFunctionDialog
          fn={fn}
          onClose={() => setDialog(null)}
          onDropped={() => {
            setDialog(null)
            refresh.mutate()
            pushToast(`Function ${fn.name} dropped`)
            close(tab.id)
          }}
        />
      )}
    </div>
  )
}
