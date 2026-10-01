import type { Profile } from './types'

export const profiles: Profile[] = [
  { id: 'local', name: 'local', hosts: '127.0.0.1:9042', status: 'connecting' },
  {
    id: 'prod-eu',
    name: 'prod-eu',
    hosts: '10.20.0.11, +1',
    status: 'connected',
    version: 'Cassandra 5.0.2',
    datacenter: 'eu-west-1 · 3 of 6 nodes local',
    tls: true,
  },
  { id: 'astra-dev', name: 'astra-dev', hosts: 'Astra DB bundle', status: 'error', error: 'Secure connect bundle has expired' },
]
