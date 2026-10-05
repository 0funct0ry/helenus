---
title: COPY TO reference
description: Export a table to CSV from the Helenus shell with the cqlsh-compatible COPY TO command.
---

```text
COPY [keyspace.]table [(column, ...)] TO 'file' | STDOUT [WITH option = value [AND option = value ...]]
```

`COPY … TO` writes CSV. Names are case-insensitive unless double-quoted. Without a keyspace, the keyspace chosen with `USE` is used. The file is written by the shell process, on the machine where the shell runs. `COPY … FROM` is not supported yet.

| Option | Default | Meaning |
| --- | --- | --- |
| `HEADER` | `false` | Write a header row of column names. |
| `DELIMITER` | `,` | Field separator, one character. |
| `QUOTE` | `"` | Quote character, one character. |
| `NULL` | empty | Text written for NULL. |
| `PAGESIZE` | `1000` | Rows fetched per page. |
| `MAXOUTPUTSIZE` | `-1` | Rows per output file. Further files are named `file.001`, `file.002`, and so on. `-1` writes one file. Files only. |
| `DATETIMEFORMAT` | `2006-01-02 15:04:05.000Z` style | A strftime pattern for timestamps, for example `%Y-%m-%d %H:%M:%S`. Supported: `%Y %m %d %H %M %S %f %z %Z %y %b %B %a %A %I %p %j %%`. |

Reads use the shell's current consistency level (`.consistency`). Records end with a newline.

## Examples

```text
COPY shop.users TO 'users.csv' WITH HEADER = true;
COPY shop.users (id, email) TO STDOUT WITH HEADER = true;
COPY shop.events TO 'events.csv' WITH DELIMITER = ';' AND NULL = 'N/A' AND MAXOUTPUTSIZE = 1000000;
```

## Output streams

With `TO STDOUT`, only the header and rows go to standard output, so the command is safe to pipe. Progress (`Processed N rows`, once a second) and the final summary go to standard error. With a file target, the summary is printed to standard output.

If the export fails or is cancelled with Ctrl-C, the files written so far are deleted.
