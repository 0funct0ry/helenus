---
title: COPY FROM reference
description: Load a CSV file into a table from the Helenus shell with the cqlsh-compatible COPY FROM command.
---

```text
COPY [keyspace.]table [(column, ...)] FROM 'file' | STDIN [WITH option = value [AND option = value ...]]
```

`COPY … FROM` reads CSV and writes it with prepared inserts. Names are case-insensitive unless double-quoted. Without a keyspace, the keyspace chosen with `USE` is used. The file is read by the shell process, on the machine where the shell runs.

Fields are matched to columns **by position**, as in cqlsh: to the column list when given, otherwise to all columns with the primary key first (partition key, then clustering columns), then the rest in the table's order. The header row is skipped, not matched by name. For name-based mapping, use the web UI's [import wizard](/helenus/docs/import-data-from-csv-or-json/).

| Option | Default | Meaning |
| --- | --- | --- |
| `HEADER` | `false` | The first row is a header and is skipped. |
| `DELIMITER` | `,` | Field separator, one character. |
| `QUOTE` | `"` | Quote character; only `"` is supported. |
| `NULL` | empty | Cell text that means NULL. NULL values are skipped rather than written. |
| `MAXBATCHSIZE` | `1` | Rows per unlogged batch, 1–100. Only consecutive rows of the same partition are batched. |
| `MAXERRORS` | `1000` | The import aborts after more than this many rejected rows. |
| `ERRFILE` | `import_<keyspace>_<table>.err` | Where rejected rows are written. The file is created only if a row is rejected. |
| `CHUNKSIZE` | — | Accepted for compatibility with cqlsh and ignored; rows are streamed. |

Writes use the shell's current consistency level (`.consistency`) and 8 concurrent requests. Timeouts and unavailable errors are retried up to three times with backoff.

## Examples

```text
COPY shop.users FROM 'users.csv' WITH HEADER = true;
COPY shop.users (id, email) FROM 'users.csv' WITH DELIMITER = ';' AND MAXERRORS = 50 AND ERRFILE = 'bad.csv';
```

```bash
cat users.csv | helenus -e "COPY shop.users FROM STDIN WITH HEADER=true"
```

`FROM STDIN` reads the shell's standard input. It cannot be combined with a script that is itself read from standard input (`-f -`), because both would consume the same stream.

## Output streams

Everything the command prints, the progress (`Processed N rows`, at most once a second) and the final summary, goes to standard error, so standard output stays clean.

## Error file

Each rejected value is a CSV row: `line, column, value, reason`, then the original fields. Fix the rows and load the error file again.
