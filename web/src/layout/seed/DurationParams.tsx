import { ParamField } from './ParamField'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the duration range generator: minimum and maximum length in seconds. */
export function DurationParams({ spec, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField label="Min seconds" value={str(p.min_seconds)} placeholder="60" error={errors['params.min_seconds']} onChange={(t) => onChange(withParam(spec, 'min_seconds', paramValue(t)))} />
      <ParamField label="Max seconds" value={str(p.max_seconds)} placeholder="86400" error={errors['params.max_seconds']} onChange={(t) => onChange(withParam(spec, 'max_seconds', paramValue(t)))} />
    </div>
  )
}
