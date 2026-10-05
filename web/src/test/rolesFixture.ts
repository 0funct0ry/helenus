import type { RolesResponse } from '../api/types'

export const rolesData: RolesResponse = {
  auth_enabled: true,
  authorizer_enabled: true,
  connected_role: 'cassandra',
  roles: [
    { name: 'cassandra', login: true, superuser: true, options: {}, member_of: [], members: [] },
    { name: 'analyst', login: true, superuser: false, options: {}, member_of: ['reader'], members: [] },
    { name: 'reader', login: false, superuser: false, options: {}, member_of: [], members: ['analyst'] },
  ],
  applicable: {
    keyspace: ['ALL', 'CREATE', 'ALTER', 'DROP', 'SELECT', 'MODIFY', 'AUTHORIZE'],
    table: ['ALL', 'ALTER', 'DROP', 'SELECT', 'MODIFY', 'AUTHORIZE'],
    function: ['ALL', 'ALTER', 'DROP', 'AUTHORIZE', 'EXECUTE'],
  },
}
