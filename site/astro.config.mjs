import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The marketing page lives at /helenus/ and the Starlight docs at /helenus/docs/.
export default defineConfig({
  site: 'https://0funct0ry.github.io',
  base: '/helenus',
  integrations: [
    starlight({
      title: 'Helenus',
      description: 'A local-first Cassandra client: cqlsh-compatible shell and web UI.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/0funct0ry/helenus' }],
      sidebar: [
        { label: 'Get started', items: [{ label: 'Install Helenus', slug: 'docs/install' }] },
        {
          label: 'Explore',
          items: [
            { label: 'Browse your schema', slug: 'docs/browse-your-schema' },
            { label: 'Understand key and type markers', slug: 'docs/key-and-type-markers' },
            { label: 'DESCRIBE reference', slug: 'docs/describe-reference' },
          ],
        },
        {
          label: 'Connect',
          items: [
            { label: 'Connect to a cluster', slug: 'docs/connect-to-a-cluster' },
            { label: 'Connect to Astra DB', slug: 'docs/connect-to-astra-db' },
            { label: 'Profiles reference', slug: 'docs/profiles-reference' },
          ],
        },
      ],
    }),
  ],
});
