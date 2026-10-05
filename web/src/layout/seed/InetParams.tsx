import { Select } from '../../ui/Select'
import { withParam } from '../../lib/seedModel'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the IP address generator: IPv4 or IPv6. */
export function InetParams({ spec, onChange }: ParamsProps) {
  return (
    <Select
      aboveDialog
      label="Version"
      value={(spec.params?.version as string) ?? 'v4'}
      options={[
        { value: 'v4', label: 'IPv4' },
        { value: 'v6', label: 'IPv6' },
      ]}
      onChange={(v) => onChange(withParam(spec, 'version', v))}
    />
  )
}
