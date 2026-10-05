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
| `github.com/ergochat/readline` | Go | Line editing, history, Ctrl-R and vi mode for the shell (listed in SPEC §3.2; recorded here for the M4 REPL). |
| (none: no pty library) | Go (test) | The REPL tests drive the real readline editor over `io.Pipe` with `FuncIsTerminal` forced on, so they send keystrokes without a pseudo-terminal. A pty library such as `creack/pty` is not in SPEC §3.2, so none was added. |
| `@codemirror/lang-java` | web | Java highlighting for user-defined function bodies in the CodeEditor (M9.09). Cassandra UDFs are written in Java (or JavaScript on 4.x). |
| `@codemirror/autocomplete` | web | Direct import of `autocompletion` and `CompletionSource` for the schema-aware completion source (M5). Already installed as a dependency of `codemirror`; now declared because the editor imports it directly. |
| `gopkg.in/inf.v0` | Go | Arbitrary-precision `decimal` values. The driver binds decimals only as `inf.Dec`, so the grid change decoder (M6) imports it directly; it was already an indirect dependency of gocql. |
