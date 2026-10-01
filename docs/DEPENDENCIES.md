# Dependencies beyond SPEC §3.2

| Dependency | Where | Reason |
|---|---|---|
| `github.com/spf13/pflag` | Go | Direct import for `*pflag.Flag` when binding flags in `internal/config`; already pulled in by Cobra. |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | web | Bundle IBM Plex locally so the UI needs no CDN (SPEC §9.2). |
| `jsdom`, `@testing-library/*` | web (dev) | Component tests with Vitest (SPEC §15). |
| `eslint`, `typescript-eslint` | web (dev) | `make lint` runs ESLint (SPEC §16.1). |
| `astro`, `@astrojs/starlight` | site | Marketing page and docs (SPEC §16.3). |
| `codemirror`, `@lezer/highlight` | web | `basicSetup` and highlight tags for the CodeMirror 6 editor. |
| `@vitejs/plugin-react`, `@types/react*`, `@eslint/js`, `globals`, `eslint-plugin-react-hooks` | web (dev) | Vite React build and lint tooling. |
