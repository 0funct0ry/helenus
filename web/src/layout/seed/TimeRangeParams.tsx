import { ParamField } from './ParamField'
import { withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/**
 * Parameter editor for the date/time range generator (timestamp, date, time and timeuuid columns). Bounds accept
 * `now`, `now-30d` (units s m h d w y), `2024-01-31` or an RFC 3339 timestamp; time columns take HH:MM:SS.
 */
export function TimeRangeParams({ spec, type, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  const clock = type.name === 'time'
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField label="From" mono value={str(p.from)} placeholder={clock ? '00:00:00' : 'now-30d'} error={errors['params.from']} onChange={(t) => onChange(withParam(spec, 'from', t))} />
      <ParamField label="To" mono value={str(p.to)} placeholder={clock ? '23:59:59' : 'now'} error={errors['params.to']} onChange={(t) => onChange(withParam(spec, 'to', t))} />
    </div>
  )
}
