---
title: Shell command reference
description: Every shell command, the flags that control the shell, and the keys that edit a line.
---

Shell commands are case-insensitive. A trailing semicolon is optional. Anything that is not a shell command is sent to Cassandra as CQL and needs a semicolon at the end. Type `HELP` for this list in the shell, or `HELP <command>` for one entry.

## Commands

| Command | What it does |
|---|---|
| `USE <keyspace>` | Switches the current keyspace and updates the prompt. |
| `CONSISTENCY [level]` | Shows or sets the consistency level: `ANY`, `ONE`, `TWO`, `THREE`, `QUORUM`, `ALL`, `LOCAL_QUORUM`, `EACH_QUORUM`, `SERIAL`, `LOCAL_SERIAL`, or `LOCAL_ONE`. |
| `SERIAL CONSISTENCY [SERIAL\|LOCAL_SERIAL]` | Shows or sets the level used by lightweight transactions. |
| `EXPAND ON\|OFF` | Turns the expanded row format on or off. |
| `FORMAT table\|expanded\|raw` | Chooses the output format. |
| `PAGING ON\|OFF\|<rows>` | Sets the page size. At a terminal the shell asks before each further page. `OFF` fetches everything. |
| `DESCRIBE …`, `DESC …` | Prints schema definitions. See the [DESCRIBE reference](/helenus/docs/describe-reference/). |
| `SHOW VERSION` | Prints the Helenus, Cassandra, CQL, and protocol versions. |
| `SHOW HOST` | Prints the connected cluster name and contact point. |
| `SOURCE '<file>'` | Runs the statements in a file. Stops at the first error. |
| `CLEAR`, `CLS` | Clears the screen. |
| `HELP [topic]` | Lists commands, or explains one. |
| `EXIT`, `QUIT` | Leaves the shell. |
| `\profile [name]` | Shows the current profile, or reconnects with another one from the config file. |

Aliases and variables (`\alias`, `\set`), `TRACING`, and `TIMING` are not available yet. Use the `--timing` flag to print the time each statement took.

## Output formats

| Format | Layout |
|---|---|
| `table` | A box-drawn grid sized to the terminal. Values that do not fit end in `…`. Collections print as CQL literals. Partition key headers are bold and clustering key headers are underlined when the terminal supports it. |
| `expanded` | `@ Row 1`, then one `column \| value` line per column. |
| `raw` | Tab-separated values. Column names first, nulls empty, no footer. |

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
