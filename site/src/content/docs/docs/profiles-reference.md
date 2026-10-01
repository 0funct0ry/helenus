---
title: Profiles reference
description: Every setting a connection profile accepts, and how flags, environment variables, and the config file combine.
---

Profiles live under `profiles:` in `config.yaml` (by default `~/.config/helenus/config.yaml`; use `-c, --config` or `HELENUS_CONFIG` to point elsewhere). Helenus keeps your comments and key order when it adds, changes, or removes a profile, and writes the file with owner-only permissions.

```yaml
profiles:
  default:
    hosts: [127.0.0.1]
    port: 9042
    keyspace: payments

  prod-eu:
    hosts: [10.20.0.11, 10.20.0.12]
    dc: eu-west-1
    username: app_reader
    password_command: "op read op://infra/cassandra-prod/password"
    tls:
      enabled: true
      ca_cert: ~/.certs/prod-ca.pem
    consistency: LOCAL_QUORUM

  astra-dev:
    astra:
      secure_bundle: ~/Downloads/secure-connect-dev.zip
      token: ${HELENUS_ASTRA_TOKEN}
```

## Settings

Each setting can be given as a profile key, an environment variable, or a command-line flag.

| Profile key | Flag | Environment variable | Default |
|---|---|---|---|
| `hosts` | `-H, --hosts` | `HELENUS_HOSTS` | `127.0.0.1` |
| `port` | `-o, --port` | `HELENUS_PORT` | `9042` |
| `username` | `-u, --username` | `HELENUS_USERNAME` | none |
| `password` | `-p, --password` | `HELENUS_PASSWORD` | none |
| `password_command` | none | none | none |
| `keyspace` | `-k, --keyspace` | `HELENUS_KEYSPACE` | none |
| `consistency` | `-C, --consistency` | `HELENUS_CONSISTENCY` | `LOCAL_ONE` |
| `serial_consistency` | `-S, --serial-consistency` | `HELENUS_SERIAL_CONSISTENCY` | `SERIAL` |
| `dc` | `-d, --dc` | `HELENUS_DC` | none |
| `tls.enabled` | `-t, --ssl` | `HELENUS_SSL` | `false` |
| `tls.ca_cert` | `-a, --ca-cert` | `HELENUS_CA_CERT` | none |
| `tls.cert` | `-r, --cert` | `HELENUS_CERT` | none |
| `tls.key` | `-K, --key` | `HELENUS_KEY` | none |
| `tls.server_name` | none | none | the node's address |
| `tls.insecure_skip_verify` | `-i, --insecure-skip-verify` | `HELENUS_INSECURE_SKIP_VERIFY` | `false` |
| `astra.secure_bundle` | `-b, --secure-bundle` | `HELENUS_SECURE_BUNDLE` | none |
| `astra.token` | `-T, --token` | `HELENUS_TOKEN` | none |
| `astra.token_command` | none | none | none |
| `connect_timeout` | `-w, --connect-timeout` | `HELENUS_CONNECT_TIMEOUT` | `5s` |
| `request_timeout` | `-R, --request-timeout` | `HELENUS_REQUEST_TIMEOUT` | `10s` |
| `protocol_version` | `-V, --protocol-version` | `HELENUS_PROTOCOL_VERSION` | automatic |

## TLS and host names

The driver connects to the addresses the contact point resolves to, so the certificate is checked against each node's address. If your certificates carry a host name rather than the node's IP address, set `tls.server_name` to that name.

## Which value wins

When the same setting is given in more than one place, Helenus uses the first of these:

1. The command-line flag.
2. The environment variable.
3. The profile in `config.yaml`.
4. The default.

On the shell, `helenus <host> [port]` sets the contact point and port and wins over `--hosts`.

## Keeping secrets out of the file

- **`${NAME}`** in `username`, `password`, or `astra.token` is replaced with the environment variable `NAME` each time you connect.
- **`password_command`** and **`astra.token_command`** run a command through your shell and use its output, with surrounding whitespace removed. Use it with a password manager. The command must finish within 5 seconds, and its output is never logged.
- **`helenus profile show`** masks passwords and tokens. The web UI can set a password or token but can never read one back.

## Turning off certificate checks

`tls.insecure_skip_verify` turns off host name and certificate checks. Anyone on the network path can then pretend to be your cluster. Helenus prints a warning on every connect, and the web UI shows **Insecure TLS** in the status bar for as long as the profile is active. Use it for throwaway test clusters only.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Usage error, such as a bad flag or an unknown profile name |
| 3 | Connection or authentication failure |
