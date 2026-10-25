# FSi Portal

## Cash register connection (Kassensystem)

The event planning workspace gains a "Kasse" tab (visible to users with the
`cash_register.manage` permission) that shows the sales overview of the linked
kassensystem event.

The content comes entirely from the kassensystem's integration API
(`GET /api/integration/v1/events/<id>/overview`), which describes the overview
as generic, already translated building blocks (stat tiles, tables, lists, an
hourly chart). The buchhaltung only renders them
([components/Page/Events/planning/cashRegister/](components/Page/Events/planning/cashRegister/)),
so changing what the tab shows only needs a kassensystem release. The
buchhaltung never reads the kassensystem database.

To enable it, set in `.env`:

- `CASH_REGISTER_MODE=connected`
- `CASH_REGISTER_API_URL` — the kassensystem's base URL including its
  `APP_BASE_URL` path (`http://kasse-app:3001` inside the shared docker network)
- `CASH_REGISTER_API_KEY` — the same value as the kassensystem's
  `INTEGRATION_API_KEY` (at least 32 characters, e.g. `openssl rand -hex 32`)
- optionally `CASH_REGISTER_API_TIMEOUT_MS` (default 10000)

### Single sign-on (SSO)

When both apps run on subdomains of the same parent domain (e.g.
`buchhaltung.example.com` and `kasse.example.com`), a user logged into the
buchhaltung can use the kassensystem without logging in again.

Set in the **buchhaltung's** `.env`:

```
COOKIE_DOMAIN=.example.com
```

The session cookie is then scoped to `.example.com` and the browser sends it to
the kassensystem as well. Set the **kassensystem's** `ACCOUNTING_SESSION_COOKIE_NAME`
to match the buchhaltung's `SESSION_COOKIE_NAME` (both default to `fsi_session_db`).

Without `COOKIE_DOMAIN` the cookie stays bound to the exact host — single-origin
deployments are unaffected.

### Connection database users

Each application creates the restricted user for the *other* application in
its own database:

```bash
npm run setup:connection-db-user
```

reads `CONNECTION_DB_USER` / `CONNECTION_DB_PASSWORD` from `.env` and creates a
user in this accounting database with only the privileges the kassensystem
needs in connected mode: `SELECT` on `users`, `members`, `events`, `roles`,
`user_roles`, `role_permissions`, `user_permissions` and
`SELECT/INSERT/UPDATE/DELETE` on `sessions`. The kassensystem then uses these
credentials as `ACCOUNTING_DB_USER` / `ACCOUNTING_DB_PASSWORD`.

The script is idempotent (it re-syncs password and grants) and runs
automatically inside docker compose; it skips itself when the env variables
are not set.
