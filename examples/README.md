# Example CQL files

Ten self-contained schemas, one per domain. Each file creates its own keyspace with user-defined types, tables, materialized views, secondary indexes, Java UDFs and a user-defined aggregate, then inserts a few sample rows. Use them to try the schema explorer, DESCRIBE, queries and the shell.

| File                     | Keyspace    | Domain             | Things to try                                                                                         |
|--------------------------|-------------|--------------------|-------------------------------------------------------------------------------------------------------|
| `01_ecommerce.cql`       | `shop`      | Storefront         | `shop.line_total(qty, price)`, `shop.total_qty(qty)`, look up a customer through `customers_by_email` |
| `02_iot_telemetry.cql`   | `iot`       | Device telemetry   | `iot.celsius_to_f(temperature)`, `iot.max_temp(temperature)`, a TTL table                             |
| `03_banking.cql`         | `bank`      | Retail banking     | `bank.mask_iban(iban)`, `bank.net_flow(kind, amount)`                                                 |
| `04_social_network.cql`  | `social`    | Social network     | A counter table (`post_counters`), `social.hashtag_count(body)`                                       |
| `05_healthcare.cql`      | `clinic`    | Patient records    | `clinic.bmi(kg, cm)`, `clinic.max_dose(dose_mg)`, nested UDT `vitals`                                 |
| `06_logistics.cql`       | `logistics` | Shipping           | `logistics.volume_m3(l, w, h)`, `logistics.total_weight(weight_kg)`, a list of UDTs                   |
| `07_gaming.cql`          | `arena`     | Multiplayer gaming | `arena.kda(kills, deaths, assists)`, a leaderboard with a composite partition key                     |
| `08_education.cql`       | `campus`    | University         | `campus.letter_grade(score)`, `campus.best_score(score)`                                              |
| `09_streaming_media.cql` | `streaming` | Video streaming    | `streaming.format_duration(sec)`, `streaming.total_seconds(sec)`                                      |
| `10_human_resources.cql` | `hr`        | HR                 | `hr.total_comp(base, bonus)`, `hr.total_overtime(hours)`                                              |

Each file holds 17 or 18 schema objects, counting the keyspace: 2 UDTs, 4 or 5 tables, 3 materialized views, 1 or 2 indexes, 2 functions and 1 aggregate.

## Requirements

- A running Cassandra 4.0 or later. The files were checked against 5.0.
- **Materialized views and user-defined functions must be enabled** on the server, or those statements fail. In `cassandra.yaml`:

  ```yaml
  materialized_views_enabled: true
  user_defined_functions_enabled: true
  ```

  To start a local node with both turned on:

  ```bash
  docker run -d --name helenus-cass -p 9042:9042 -e MAX_HEAP_SIZE=512M -e HEAP_NEWSIZE=128M --entrypoint bash cassandra:5.0 -c "sed -i 's/^materialized_views_enabled:.*/materialized_views_enabled: true/; s/^user_defined_functions_enabled:.*/user_defined_functions_enabled: true/' /etc/cassandra/cassandra.yaml; exec docker-entrypoint.sh cassandra -f"
  ```

  Wait until `docker logs helenus-cass` shows "Starting listening for CQL clients".
- If a file stops with `Materialized views are disabled. Enable in cassandra.yaml to use.` (or a similar error about user-defined functions), the setting above is still off on the server. Enable it and restart the node, then load the file again. It is safe to repeat because the files use `IF NOT EXISTS`. `.source` and `-f` stop at the first error; add `-x` to `-f` to carry on past failing statements.
- The keyspaces use `SimpleStrategy` with replication factor 1, which suits a single local node. Change it before using a multi-node cluster.

## Load a file

With the Helenus shell (add `-c <config>` or a profile flag if you do not use the default profile):

```bash
./bin/helenus -f examples/01_ecommerce.cql
```

Load all ten:

```bash
for f in examples/*.cql; do ./bin/helenus -f "$f" || break; done
```

With `cqlsh`, for comparison:

```bash
cqlsh -f examples/01_ecommerce.cql
```

From inside the shell, use `.source 'examples/01_ecommerce.cql';`.

The files use `IF NOT EXISTS` and `OR REPLACE`, so loading one twice is safe. The sample `INSERT` statements are upserts, except the ones using `uuid()` or `now()`, which add a new row each time. The counter update in the social example also adds to the counts on every run.

After loading, refresh the schema tree in the web UI to see the new keyspaces.

## Try some queries

```sql
USE shop;
.describe keyspace shop
SELECT * FROM customers_by_email WHERE email = 'ada@example.com';
SELECT shop.total_qty(qty) FROM order_items WHERE order_id = 11111111-1111-1111-1111-111111111111;

SELECT hr.total_comp(comp.base, comp.bonus) FROM hr.employees;
SELECT hr.total_overtime(hours) FROM hr.timesheets WHERE employee_id = 56565656-0000-0000-0000-000000000001;
```

Some tables are queryable only by their partition key, so you may see a request to use ALLOW FILTERING. Use that to try the retry flow in the UI and the hint in the shell.

## Clean up

Dropping a keyspace removes everything in it:

```bash
./bin/helenus -e "DROP KEYSPACE IF EXISTS shop; DROP KEYSPACE IF EXISTS iot; DROP KEYSPACE IF EXISTS bank; DROP KEYSPACE IF EXISTS social; DROP KEYSPACE IF EXISTS clinic; DROP KEYSPACE IF EXISTS logistics; DROP KEYSPACE IF EXISTS arena; DROP KEYSPACE IF EXISTS campus; DROP KEYSPACE IF EXISTS streaming; DROP KEYSPACE IF EXISTS hr;"
```

Do not drop the `system*` keyspaces.
