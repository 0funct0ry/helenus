---
title: Generator reference
description: Every seed data generator, the column types it fits, its parameters and defaults.
---

Generators are chosen per column in the [seed wizard](/helenus/docs/seed-a-table-with-test-data/). All parameters are optional unless noted.

| Generator | Fits | Parameters |
| --- | --- | --- |
| Constant | any | `value` (required, parsed by column type) |
| Null | any non-key column | none |
| Sequence | integer types, `text`, `ascii`, `varchar` | `start` (1), `step` (1), `prefix` (text only) |
| UUID (v4) | `uuid` | none |
| TimeUUID | `timeuuid` | `from` (`now-30d`), `to` (`now`) |
| Integer range | `tinyint`, `smallint`, `int`, `bigint`, `varint`, `counter` | `min` (0), `max` (1000); counters default to 1 to 10 |
| Float range | `float`, `double` | `min` (0), `max` (1000), `decimals` (2, up to 10) |
| Decimal range | `decimal` | `min`, `max`, `decimals` as above |
| Boolean | `boolean` | `p_true` (0.5) |
| Choice | scalar types | `values` (required), `weights` (equal) |
| Date/time range | `timestamp`, `date`, `time` | `from`, `to`: `now`, `now-30d`, `now+2h`, `2024-01-31` or RFC 3339; `time` columns take `HH:MM:SS` |
| Duration range | `duration` | `min_seconds` (60), `max_seconds` (86400) |
| IP address | `inet` | `version`: `v4` or `v6` |
| Random bytes | `blob` | `min_len` (8), `max_len` (32, up to 4096) |
| Regex | `text`, `ascii`, `varchar` | `pattern` (required) |
| Fake data | `text`, `ascii`, `varchar`; `inet` (ipv4, ipv6); `date` (birthdate) | `category` |
| Collection | `list`, `set`, `map` | `min` (0), `max` (3, up to 50), element generator, key generator for maps |
| Tuple / UDT | `tuple`, user-defined types | one generator per field |
| Vector | `vector` | `min` (-1), `max` (1), `decimals` (4) |

Relative times such as `now` are anchored to the start of the current UTC day, so two previews on the same day agree.

## Regular expressions

Patterns use Go's syntax. `*`, `+` and `{n,}` repeat at most 8 times (at least `n`), `.` produces printable ASCII, anchors and word boundaries are ignored, and the result is cut at 1,024 characters. `[A-Z]{3}-\d{4}` produces values such as `QXT-0491`. An invalid pattern shows Go's error message under the field.

## Fake data categories

`first_name`, `last_name`, `full_name`, `email`, `username`, `phone`, `company`, `job_title`, `street`, `city`, `state`, `country`, `zip`, `url`, `ipv4`, `ipv6`, `word`, `sentence`, `paragraph`, `color`, `product`, `birthdate`.

Defaults for text columns follow the column name: `email`, `first_name`, `last_name`, `name`, `phone`, `city`, `country`, `company`, `url` and `zip` use the matching category, anything else uses `word`.

## Null percent

Every non-key column can be null in a percentage of rows (0 to 100). Counter columns and primary-key columns cannot.
