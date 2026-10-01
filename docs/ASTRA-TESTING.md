# Testing Astra DB connectivity by hand

The Astra code in `internal/astra` is covered by unit tests only (bundle parsing, the metadata client against an `httptest` TLS server). Nothing in CI talks to a real Astra database, and the SNI host dialer has never been exercised against Astra's proxy (SPEC risk R1). Run this check against a real database before relying on Astra support, and after any change to `internal/astra` or the Astra branch of `internal/conn/cluster.go`.

## What you need

- An Astra DB database (the free tier is enough) in the **Active** state, not hibernated.
- Its **secure connect bundle** (`secure-connect-<db>.zip`), from the database's *Connect* tab.
- An **application token** (`AstraCS:…`) with at least the *Database Administrator* or *Organization Administrator* role.
- A built binary: `make build`.

## Steps

1. Put the token in the environment and create a profile:

   ```bash
   export HELENUS_ASTRA_TOKEN='AstraCS:…'
   ./bin/helenus profile add astra-check \
     --secure-bundle ~/Downloads/secure-connect-<db>.zip \
     --token '${HELENUS_ASTRA_TOKEN}'
   ```

2. Run the staged test:

   ```bash
   ./bin/helenus profile test astra-check
   ```

   Expected: a `metadata` line marked `ok`, then `auth` and `protocol` marked `ok`, then a `Connected:` line with the Cassandra version, cluster name, datacenter count, and node count. Exit code 0.

3. Connect from the shell:

   ```bash
   ./bin/helenus --profile astra-check
   ```

   Expected: the banner (`Connected to astra-check (Cassandra …)`), then the `helenus>` prompt. Type `EXIT`.

4. Connect from the web UI:

   ```bash
   ./bin/helenus ui
   ```

   Open **Manage profiles…**, select `astra-check`, select **Test connection**, and confirm the staged result is green. Close the dialog, pick `astra-check` in the title bar, and confirm the status bar shows the version, datacenter, and node count. Then create a second profile from scratch on the **Astra DB** tab using **Upload bundle…** and confirm it connects too.

## Failure cases to confirm

| Change | Expected result |
|---|---|
| Wrong token (edit one character) | Fails at `auth` with a credentials error, exit code 3. |
| Path to a zip that is not a bundle | Fails at `metadata` naming the missing file (`config.json`, `ca.crt`, `cert`, or `key`). |
| Hibernated database | Fails at `metadata` (the metadata service does not answer). Resume the database and retry. |
| No token | The test fails with "astra profiles need a token". |

## If step 2 fails at `auth` or `protocol` with a valid token

That points at the host dialer rather than the credentials. The dialer connects to the SNI proxy address from the metadata response and sets the TLS server name to each node's host ID. Things to check, in order:

1. Does the metadata response contain `contact_points` and `sni_proxy_address`? Fetch it with `curl --cert cert --key key --cacert ca.crt https://<host>:<port>/metadata` using the files from the unzipped bundle (`<host>` and `<port>` are in `config.json`).
2. Does the initial connection get a host ID? The dialer falls back to the first contact point when the driver has not discovered the host yet (`astra.HostDialer.DefaultHostID`).
3. Compare with `datastax/gocql-astra`, which this code is modeled on.

Record the outcome (date, database region, driver version) in the pull request that touches the Astra code.
