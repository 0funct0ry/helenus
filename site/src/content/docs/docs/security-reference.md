---
title: Security reference
description: How web UI sign-in, sessions, CSRF protection, rate limiting and the network guard work.
---

## Network guard

| Bind address | Sign-in | Result |
|---|---|---|
| Loopback (`127.0.0.1`, `[::1]`, `localhost`) | off | Starts. Requests with a non-loopback `Host` header get 421 (DNS rebinding protection). |
| Loopback | on | Starts. |
| Anything else (`0.0.0.0`, `:4042`, a LAN address) | off | Refuses to start and prints the fix. |
| Anything else | on, no TLS | Starts with a warning on stderr and in the status bar. |
| Anything else | on, TLS | Starts. |

## Flags

| Flag | Short | Env var | Config key | Default |
|---|---|---|---|---|
| `--auth` | `-A` | `HELENUS_AUTH` | `ui.auth.enabled` | false |
| `--tls-cert` | `-C` | `HELENUS_TLS_CERT` | `ui.tls.cert` | none |
| `--tls-key` | `-K` | `HELENUS_TLS_KEY` | `ui.tls.key` | none |
| `--db` | `-D` | `HELENUS_DB` | `paths.db` | XDG data path |

## Accounts

- Users are stored in SQLite, created only by `helenus user add`.
- Passwords are at least 12 characters and hashed with bcrypt at cost 12.

## Sessions

- On sign-in the server sets an HS256 JWT (`sub`, `ver`, `iat`, `exp`) in an `HttpOnly; SameSite=Strict` cookie named `helenus_session`, with `Secure` when Helenus serves TLS.
- Lifetime is 12 hours. When less than 2 hours remain, the next request quietly sets a fresh cookie.
- The signing key is 32 random bytes generated on first use and kept in the `settings` table of the SQLite file. Deleting that row signs everyone out.
- Each token carries the user's `token_version`. Sign out, `helenus user passwd` and `helenus user remove` change or delete it, which invalidates every earlier token at once.

## Which routes need a session

With sign-in on, every `/api/v1` route except `GET /meta`, `GET /healthz` and `POST /auth/login` answers 401 without a valid session. The web app itself is served without one, so it can show the sign-in screen.

## CSRF

- The cookie is `SameSite=Strict`.
- Every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) must send `Content-Type: application/json`, otherwise 415.
- The two upload endpoints (Astra bundle and import file) take `multipart/form-data` and also require `X-Helenus-Request: 1`, which a cross-site form cannot set.

## Rate limiting

Sign-in is limited to 5 attempts per minute per client address and 5 per minute per username (answer 429). Every other failure returns the same message, "Incorrect username or password.", whether or not the user exists.

## What is not protected

Sign-in controls access to the web UI only. It does not restrict which CQL a signed-in user can run; that is decided by the Cassandra role of the saved profile.
