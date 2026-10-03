---
title: Shell command reference
description: Every shell command, the flags that control the shell, and the keys that edit a line.
---

Shell commands are lowercase and start with a dot. A trailing semicolon is optional. Anything that does not start with a dot is sent to Cassandra as CQL and needs a semicolon at the end. Type `.help` for this list in the shell, or `.help <command>` for one entry.

## Commands

| Command | What it does |
|---|---|
| `.use <keyspace>` | Switches the current keyspace and updates the prompt. A plain `USE <keyspace>;` statement works too. |
| `.consistency [level]` | Shows or sets the consistency level: `ANY`, `ONE`, `TWO`, `THREE`, `QUORUM`, `ALL`, `LOCAL_QUORUM`, `EACH_QUORUM`, `SERIAL`, `LOCAL_SERIAL`, or `LOCAL_ONE`. |
| `.serial consistency [SERIAL\|LOCAL_SERIAL]` | Shows or sets the level used by lightweight transactions. |
| `.expand on\|off` | Turns the expanded row format on or off. |
| `.format table\|expanded\|raw` | Chooses the output format. |
| `.paging on\|off\|<rows>` | Sets the page size. At a terminal the shell asks before each further page. `OFF` fetches everything. |
| `.describe …`, `.desc …` | Prints schema definitions. See the [DESCRIBE reference](/helenus/docs/describe-reference/). |
| `.tables`, `.views`, `.types`, `.functions`, `.aggregates`, `.indexes`, `.triggers` | Lists that kind of object in the current keyspace as a colored table. Select a keyspace with `.use` first, otherwise the shell asks you to. |
| `.show version` | Prints the Helenus, Cassandra, CQL, and protocol versions. |
| `.show host` | Prints the connected cluster name and contact point. |
| `.show session <trace-id>` | Prints a stored trace as a table. |
| `.tracing on\|off` | Traces every statement and prints the trace table after its results. With no argument, shows the state. |
| `.timing on\|off` | Prints `Time: 38.2 ms` to stderr after each statement. With tracing on, it adds the coordinator time: `Time: 38.2 ms (coordinator 31.7 ms)`. |
| `.source '<file>'` | Runs the statements in a file. Stops at the first error. |
| `.clear`, `.cls` | Clears the screen. |
| `.help [topic]` | Lists commands, or explains one. |
| `.exit`, `.quit` | Leaves the shell. |
| `.profile [name]` | Shows the current profile, or reconnects with another one from the config file. |
| `.alias [name [= body]]` | Lists aliases, shows one, or defines one for this session. See [Save time with aliases and abbreviations](/helenus/docs/save-time-with-aliases-and-abbreviations/). |
| `.alias --save [name]` | Writes one alias (or all of them) to the config file. |
| `.alias --dry-run :name [args]` | Prints the CQL an alias expands to without running it. |
| `.unalias <name>` | Removes an alias for this session. |
| `:name [args]` | Runs an alias. |
| `.set [name [value]]` | Lists or sets a template variable. |
| `.unset <name>` | Removes a template variable. |
| `.abbrev` | Lists abbreviations. |

The `--timing` flag starts the shell with `.timing on`. See [Trace a slow query](/helenus/docs/trace-a-slow-query/).

## Output formats

| Format | Layout |
|---|---|
| `table` | A box-drawn grid sized to the terminal. Values that do not fit end in `…`. Collections print as CQL literals. Partition key headers are bold and clustering key headers are underlined when the terminal supports it. |
| `expanded` | `@ Row 1`, then one `column \| value` line per column. |
| `raw` | Tab-separated values. Column names first, nulls empty, no footer. |

On a terminal, tables and expanded rows are colored: dim borders, cyan column names, and separate colors for numbers, booleans, UUIDs, timestamps, and nulls. Anything the shell lists (`.help`, `.alias`, `.set`, `.abbrev`, `.show`, `.describe` lists, and the `.tables` family) uses the same table, and CQL such as DDL, alias bodies, and echoed script statements is syntax highlighted. Colors are off when output is piped or `NO_COLOR` is set.

After `table` and `expanded` results, a footer shows the row count, for example `(3 rows)`. Warnings from Cassandra and timing print to standard error.

## Paging prompt

When more rows are waiting, the shell shows `--More--`.

| Input | Effect |
|---|---|
| Enter | Show the next page. |
| `q`, then Enter | Stop. |
| Ctrl-C | Stop. |

## Keys

| Key | Action |
|---|---|
| Up, Down | Move through history. |
| Ctrl-R | Search history backwards. |
| Ctrl-C | Drop the statement you are typing, or cancel the running query. |
| Ctrl-D | Leave the shell (on an empty line). |
| Ctrl-A, Ctrl-E | Go to the start or end of the line. |
| Ctrl-L | Clear the screen. |

With `--vi-mode`, line editing uses vi keys instead.

## Flags, environment variables, and config keys

These flags belong to the `helenus` command. See [Run scripts with -f and -e](/helenus/docs/run-scripts-with-f-and-e/) for the non-interactive ones.

| Flag | Environment variable | Config key | Default |
|---|---|---|---|
| `-e, --execute` | `HELENUS_EXECUTE` | none | none |
| `-f, --file` | `HELENUS_FILE` | none | none |
| `-F, --format` | `HELENUS_FORMAT` | `shell.format` | `table` |
| `-E, --echo` | `HELENUS_ECHO` | `shell.echo` | `false` |
| `-x, --continue-on-error` | `HELENUS_CONTINUE_ON_ERROR` | `shell.continue_on_error` | `false` |
| `-q, --quiet` | `HELENUS_QUIET` | `shell.quiet` | `false` |
| `-g, --paging` | `HELENUS_PAGING` | `shell.paging` | `100` |
| `-m, --timing` | `HELENUS_TIMING` | `shell.timing` | `false` |
| `-v, --vi-mode` | `HELENUS_VI_MODE` | `shell.vi_mode` | `false` |
| `-n, --history-size` | `HELENUS_HISTORY_SIZE` | `shell.history_size` | `10000` |
| `-j, --history-file` | `HELENUS_HISTORY_FILE` | `paths.history` | `~/.local/state/helenus/history` |

A flag overrides the environment variable, which overrides the config file, which overrides the default.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | Cassandra returned an error. |
| 2 | Wrong flags or unknown profile. |
| 3 | Connection or sign-in failure. |
| 4 | A `-f` file stopped at a failing statement. |
