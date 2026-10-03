---
title: DESCRIBE reference
description: Every DESCRIBE form the Helenus shell accepts, plus .show version and .show host.
---

`.describe` (or `.desc`) prints the definition of schema objects. A trailing semicolon is optional. Unquoted names are case-insensitive; put a name in double quotes to keep its case.

## Forms

| Statement | Prints |
|---|---|
| `.describe cluster` | Cluster name, partitioner, and snitch. Needs Cassandra 4.0 or newer. |
| `.describe keyspaces` | The names of all keyspaces. |
| `.describe keyspace [name]` | The keyspace and everything in it: types, functions, aggregates, tables with their indexes, and views. Without a name, the current keyspace. |
| `.describe tables` | Tables and views, grouped by keyspace. |
| `.describe table [keyspace.]name` | The table and its indexes. |
| `.describe types` | User-defined types, grouped by keyspace. |
| `.describe type [keyspace.]name` | One user-defined type. |
| `.describe materialized view [keyspace.]name` | One materialized view. |
| `.describe index [keyspace.]name` | One index. |
| `.describe functions` | User-defined functions, grouped by keyspace. |
| `.describe function [keyspace.]name` | One user-defined function. |
| `.describe aggregates` | User-defined aggregates, grouped by keyspace. |
| `.describe aggregate [keyspace.]name` | One user-defined aggregate. |
| `.describe schema` | The `CREATE` statements for every non-system keyspace. |
| `.describe full schema` | Everything in `.describe schema`, plus system keyspaces. |
| `.describe [keyspace.]name` | Whichever keyspace, table, view, index, type, function, or aggregate has that name, checked in that order. |

## Where the output comes from

On Cassandra 4.0 and newer, Helenus sends a `DESCRIBE` statement to the server and prints what it returns, so the DDL is exactly what `cqlsh` shows. The list forms (`.describe keyspaces`, `tables`, `types`, `functions`, `aggregates`, and `cluster`) print a table instead of the server's plain list, and DDL is syntax highlighted on a terminal. On Cassandra 3.11, which cannot answer `DESCRIBE`, Helenus builds the same statements from the cluster's schema tables. The web UI's **DDL** view uses the same code.

## Other commands

| Statement | Prints |
|---|---|
| `.show version` | A table with the Helenus version, Cassandra version, CQL spec, and native protocol version. |
| `.show host` | A table with the cluster name and the contact point you connected to. |

## Example

```text
helenus> .describe table payments.ledger_counters;

CREATE TABLE payments.ledger_counters (
    account_id uuid,
    day date,
    credits counter,
    debits counter,
    PRIMARY KEY (account_id, day)
) WITH CLUSTERING ORDER BY (day DESC)
    AND additional_write_policy = '99p'
    ...
```

## Errors

- `no keyspace specified and no current keyspace`: give the name as `keyspace.name`.
- `Table 'x' not found`: check the spelling, or that the name is in the keyspace you gave.
