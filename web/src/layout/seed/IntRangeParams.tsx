import { ParamField } from './ParamField'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the integer range generator (also counters): min and max, inclusive. */
export function IntRangeParams({ spec, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField label="Min" value={str(p.min)} placeholder="0" error={errors['params.min']} onChange={(t) => onChange(withParam(spec, 'min', paramValue(t)))} />
      <ParamField label="Max" value={str(p.max)} placeholder="1000" error={errors['params.max']} onChange={(t) => onChange(withParam(spec, 'max', paramValue(t)))} />
    </div>
  )
}
