import type { RoleResource } from '../api/types'

/** Stable identity of a resource, used for matrix rows and pending-change keys. */
export function resourceKey(r: RoleResource): string {
  return [r.kind, r.keyspace ?? '', r.name ?? '', (r.signature ?? []).join(',')].join('|')
}

/** The CQL-style label for a resource, such as `KEYSPACE shop` or `ALL ROLES`. */
export function resourceLabel(r: RoleResource): string {
  switch (r.kind) {
    case 'all_keyspaces':
      return 'ALL KEYSPACES'
    case 'keyspace':
      return `KEYSPACE ${r.keyspace}`
    case 'table':
      return `TABLE ${r.keyspace}.${r.name}`
    case 'all_roles':
      return 'ALL ROLES'
    case 'role':
      return `ROLE ${r.name}`
    case 'all_functions':
      return 'ALL FUNCTIONS'
    case 'all_functions_in_keyspace':
      return `ALL FUNCTIONS IN KEYSPACE ${r.keyspace}`
    case 'function':
      return `FUNCTION ${r.keyspace}.${r.name}(${(r.signature ?? []).join(', ')})`
    case 'all_mbeans':
      return 'ALL MBEANS'
    case 'mbean':
      return `MBEAN ${r.name}`
  }
  return r.name ?? r.kind
}
