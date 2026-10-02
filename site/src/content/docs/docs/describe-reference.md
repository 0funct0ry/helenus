---
title: DESCRIBE reference
description: Every DESCRIBE form the Helenus shell accepts, plus SHOW VERSION and SHOW HOST.
---

`DESCRIBE` (or `DESC`) prints the definition of schema objects. A trailing semicolon is optional. Unquoted names are case-insensitive; put a name in double quotes to keep its case.

## Forms

| Statement | Prints |
|---|---|
| `DESCRIBE CLUSTER` | Cluster name, partitioner, and snitch. Needs Cassandra 4.0 or newer. |
| `DESCRIBE KEYSPACES` | The names of all keyspaces. |
| `DESCRIBE KEYSPACE [name]` | The keyspace and everything in it: types, functions, aggregates, tables with their indexes, and views. Without a name, the current keyspace. |
| `DESCRIBE TABLES` | Tables and views, grouped by keyspace. |
| `DESCRIBE TABLE [keyspace.]name` | The table and its indexes. |
| `DESCRIBE TYPES` | User-defined types, grouped by keyspace. |
| `DESCRIBE TYPE [keyspace.]name` | One user-defined type. |
| `DESCRIBE MATERIALIZED VIEW [keyspace.]name` | One materialized view. |
| `DESCRIBE INDEX [keyspace.]name` | One index. |
| `DESCRIBE FUNCTIONS` | User-defined functions, grouped by keyspace. |
| `DESCRIBE FUNCTION [keyspace.]name` | One user-defined function. |
| `DESCRIBE AGGREGATES` | User-defined aggregates, grouped by keyspace. |
| `DESCRIBE AGGREGATE [keyspace.]name` | One user-defined aggregate. |
| `DESCRIBE SCHEMA` | The `CREATE` statements for every non-system keyspace. |
| `DESCRIBE FULL SCHEMA` | Everything in `DESCRIBE SCHEMA`, plus system keyspaces. |
| `DESCRIBE [keyspace.]name` | Whichever keyspace, table, view, index, type, function, or aggregate has that name, checked in that order. |

## Where the output comes from

On Cassandra 4.0 and newer, Helenus sends `DESCRIBE` to the server and prints what it returns, so the output is exactly what `cqlsh` shows. On Cassandra 3.11, which cannot answer `DESCRIBE`, Helenus builds the same statements from the cluster's schema tables. The web UI's **DDL** view uses the same code.

## Other commands

| Statement | Prints |
|---|---|
| `SHOW VERSION` | The Helenus version, then the Cassandra version, CQL spec, and native protocol version. |
| `SHOW HOST` | The cluster name and the contact point you connected to. |

## Example

```text
helenus> DESCRIBE TABLE payments.ledger_counters;

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
