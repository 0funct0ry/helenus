---
title: Template function reference
description: The functions and variables you can use in alias bodies.
---

Alias bodies use Go `text/template` syntax. Only the functions below exist. Using a variable that is not defined is an error.

## Variables

| Name | Value |
|---|---|
| `.keyspace` | The current keyspace. |
| `.profile` | The current profile name. |
| `.consistency` | The current consistency level. |
| `.<name>` | Any variable set with `.set`. |

## Functions

| Function | Result |
|---|---|
| `arg N` | The Nth argument after the alias name, counting from 0. Empty when missing. |
| `args` | All arguments, as a list. |
| `default D V` | `D` when `V` is empty. Usually written `arg 1 \| default 20`. |
| `quote V` | A CQL string literal. Single quotes are doubled: `it's` becomes `'it''s'`. |
| `ident V` | A CQL identifier, double-quoted when it is a reserved word, has capitals, or has other characters. |
| `now` | The current time in UTC, RFC 3339. |
| `today` | Today's date in UTC, `YYYY-MM-DD`. |
| `ago "24h"` | The time that long ago. Accepts Go durations plus `d` (days) and `w` (weeks). |
| `uuid` | A random UUID. |
| `timeuuid` | A time-based UUID for the current time. |
| `env "NAME"` | An environment variable. |
| `upper`, `lower` | Change case. |
| `join SEP LIST` | Join a list. |
| `split SEP TEXT` | Split text into a list. |

Arguments are inserted as typed. Wrap one in `quote` when it is text: `{{ arg 0 | quote }}`. Quote arguments with spaces on the command line: `:find "two words"`.
