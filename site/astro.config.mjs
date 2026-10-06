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
            { label: 'Create a keyspace', slug: 'docs/create-a-keyspace' },
            { label: 'Change or drop a keyspace', slug: 'docs/change-or-drop-a-keyspace' },
            { label: 'Create a table', slug: 'docs/create-a-table' },
            { label: 'Data modeling tips in Helenus', slug: 'docs/data-modeling-tips-in-helenus' },
            { label: 'Change a table', slug: 'docs/change-a-table' },
            { label: 'Truncate or drop a table', slug: 'docs/truncate-or-drop-a-table' },
            { label: 'Add an index to a table', slug: 'docs/add-an-index-to-a-table' },
            { label: 'Create a materialized view', slug: 'docs/create-a-materialized-view' },
            { label: 'Write a user-defined function', slug: 'docs/write-a-user-defined-function' },
            { label: 'Build a user-defined aggregate', slug: 'docs/build-a-user-defined-aggregate' },
            { label: 'Attach a trigger to a table', slug: 'docs/attach-a-trigger-to-a-table' },
            { label: 'Manage roles and permissions', slug: 'docs/manage-roles-and-permissions' },
            { label: 'Explore system keyspaces', slug: 'docs/explore-system-keyspaces' },
            { label: 'Understand key and type markers', slug: 'docs/key-and-type-markers' },
            { label: 'DESCRIBE reference', slug: 'docs/describe-reference' },
          ],
        },
        {
          label: 'Query',
          items: [
            { label: 'Run queries in the web UI', slug: 'docs/run-queries-in-the-web-ui' },
            { label: 'Page through large results', slug: 'docs/page-through-large-results' },
            { label: 'Edit rows in the grid', slug: 'docs/edit-rows-in-the-grid' },
            { label: 'Edit lists, sets, and maps', slug: 'docs/edit-lists-sets-and-maps' },
            { label: 'How Helenus turns edits into CQL', slug: 'docs/how-helenus-turns-edits-into-cql' },
            { label: 'Create and change user-defined types', slug: 'docs/create-and-change-user-defined-types' },
            { label: 'Export data', slug: 'docs/export-data' },
            { label: 'Import data from CSV or JSON', slug: 'docs/import-data-from-csv-or-json' },
            { label: 'Consistency levels', slug: 'docs/consistency-levels' },
            { label: 'Trace a slow query', slug: 'docs/trace-a-slow-query' },
            { label: 'Read a trace', slug: 'docs/read-a-trace' },
            { label: 'Autocomplete in the editor and shell', slug: 'docs/autocomplete-in-the-editor-and-shell' },
            { label: 'Use the shell', slug: 'docs/use-the-shell' },
            { label: 'Run scripts with -f and -e', slug: 'docs/run-scripts-with-f-and-e' },
            { label: 'Shell command reference', slug: 'docs/shell-command-reference' },
            { label: 'COPY TO reference', slug: 'docs/copy-to-reference' },
            { label: 'COPY FROM reference', slug: 'docs/copy-from-reference' },
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
        {
          label: 'Secure',
          items: [
            { label: 'Protect the web UI with a password', slug: 'docs/protect-the-web-ui-with-a-password' },
            { label: 'Run Helenus on a shared machine', slug: 'docs/run-helenus-on-a-shared-machine' },
            { label: 'Security reference', slug: 'docs/security-reference' },
          ],
        },
      ],
    }),
  ],
});
