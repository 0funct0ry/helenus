import { ParamField } from './ParamField'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the sequence generator: start, step and, for text columns, a prefix. */
export function SequenceParams({ spec, type, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  const text = ['text', 'ascii', 'varchar'].includes(type.name)
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField label="Start" value={str(p.start)} placeholder="1" error={errors['params.start']} onChange={(t) => onChange(withParam(spec, 'start', paramValue(t)))} />
      <ParamField label="Step" value={str(p.step)} placeholder="1" error={errors['params.step']} onChange={(t) => onChange(withParam(spec, 'step', paramValue(t)))} />
      {text && <ParamField label="Prefix" value={str(p.prefix)} error={errors['params.prefix']} onChange={(t) => onChange(withParam(spec, 'prefix', t))} />}
    </div>
  )
}
