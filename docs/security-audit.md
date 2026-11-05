# Security audit — fix plan

**Audit date:** 2026-11-05 · **Commit:** `69d4793` (master) · **Method:** read-only static review of `server/`, `components/`, `composables/`, `utils/`, `service-worker/`, `scripts/`, `db/`, Docker/env config, plus `npm audit --omit=dev`. Nothing was exploited at runtime; every finding below was traced in code. Items marked ✅ were additionally re-verified by hand against the source.

This document is a work order for a coding agent. Read [CLAUDE.md](../CLAUDE.md) first — the fixes must follow its conventions (handlers return `{ ok:false, error }` instead of throwing, `requirePermission` first, `withAuditTransaction` for writes, schema changes need `init.sql` + migration script + `package.json` + `docker-compose.yml` + `scripts/migration-list.mjs`, new permission keys go into `config/permissions.ts` + `PERMISSIONS` + i18n `de`/`en` + `scripts/seed-admin.mjs`, user-facing text through `t()`).

## How to work through this

- Fix in the order of the **Priority list** below. Each finding has an ID (e.g. `SEC-01`); reference it in commit messages.
- One finding (or one tightly related group) per commit. After each: `npm run test` and `npm run typecheck`. For anything in `server/utils/**`, permissions, sessions, audit or transactions also run `npm run test:db` (start the test DB via the `start-docker` skill if needed).
- **Add a regression test for every High/Medium fix** — `tests/db/` for permission/transaction/attachment behaviour (use `signIn()`, `resetDatabase()`, fixtures), `tests/unit/` for pure helpers (path containment, PNG limits, email validation…).
- When a fix changes behaviour visible to users (new error messages, new permission), add i18n keys in both `de` and `en`.
- If a fix turns out to be larger than described or conflicts with an intended feature, stop and leave a note in this file under the finding rather than guessing — several items (marked **Decision needed**) require the project owner's call.
- Tick the checkbox when done.

## Owner decisions (2026-11-05)

These override the "Fix" text of the individual findings where they differ.

- **SEC-01:** new permission `positions.assign` (seeded for admin; migration grants it to roles holding `permissions.manage`). Assigning a position whose permissions exceed the caller's own additionally requires `permissions.manage`. Account link changes need `users.manage` and go through the "already linked" check; omitted `account` keeps the link; `UNIQUE (members.account)` with a migration that fails loudly on duplicates.
- **SEC-03:** rule = "target may not hold any effective permission the caller lacks". Admin password reset does **not** set `must_change_password` (also not in SEC-24).
- **SEC-04:** audit defaults, in-memory limiter, `TRUST_PROXY` env.
- **SEC-05/10/31:** DB port bound to localhost + no password fallbacks; restricted runtime DB user + separate migration service. App port stays as is; no Dockerfile/runtime change (SEC-31 skipped).
- **SEC-09:** password re-entry, HMAC signing; unsigned/foreign snapshots allowed only with explicit confirmation; token bound to user; persistent restore log.
- **SEC-12:** other headers enforced, CSP report-only first; Nitro middleware.
- **SEC-15:** only `open`/`paid` records linkable (receipts need a file); on removal recompute status (no migration).
- **SEC-16:** when locked, only description/notes stay editable (no file replacement either).
- **SEC-17:** feed shows what the in-app calendar shows; `calendar.view` required. No automatic token revocation on password change.
- **SEC-19/24:** gated member-"left" deactivation; last-admin guard; calendar-feed revoke button.
- **SEC-22:** per-domain `reimbursements.unlock`, `bank_statements.unlock`, `cash_counts.unlock` — seed-admin only, **no migration**. The permission does not make a record editable by itself: the editor shows an "Entsperren" button with a confirmation, and only saves sent after that (`unlock=true`) pass; without the flag the server answers `RECORD_UNLOCK_REQUIRED_ERROR`.
- **SEC-01 (revised):** `positions.assign` is **not** implied by `permissions.manage` (different tasks). `migrate-security-hardening.mjs` grants it once to every role/position/user holding `permissions.manage` (marker row in `system_events`, so later deploys don't re-grant it after an admin removed it).
- **SEC-25:** minimum 10 characters, maximum 72 bytes.
- **SEC-26:** unsubscribe = confirmation page + POST + RFC 8058 header.
- **SEC-27:** only `bild:` images; validation error on save/publish.
- **SEC-29:** notification delete own-only (unless `settings.notifications.manage`); bank options need `bank_statements.edit`. Self-approval of pending changes: leave as is.
- **SEC-33:** remove `reimbursements.view` from the default role in `seed-admin.mjs` only — **no migration**.
- **SEC-14:** include nodemailer 10 in a separate commit.

## Priority list

| # | ID | Sev | Title |
|---|---|---|---|
| 1 | SEC-01 | **High** | `members.edit` / `settings.positions.manage` can grant themselves any permission via positions and account linking |
| 2 | SEC-02 | **High** | Attachment saves accept arbitrary `fileId`s → bypass of `canReadFile` (wiki, notifications, templates, test mail) |
| 3 | SEC-03 | **High** | `users.manage` can take over higher-privileged accounts (admin password reset etc.) |
| 4 | SEC-04 | **High** | No brute-force protection on login; login is also an unauthenticated bcrypt CPU-DoS |
| 5 | SEC-05 | **High\*** | MariaDB port published on all interfaces with fallback default passwords (\*if host is reachable) |
| 6 | SEC-06 | Medium | Transactions commit when a handler returns `{ok:false}` → partial writes, validation/lock bypass |
| 7 | SEC-07 | Medium | Unbounded request bodies buffered in memory (incl. unauthenticated login) |
| 8 | SEC-08 | Medium | Stored `file_path` never checked against `UPLOAD_DIR` (arbitrary file read/delete via crafted snapshot) |
| 9 | SEC-09 | Medium | Snapshot restore: unaudited, unsigned, rewrites `entity_versions` |
| 10 | SEC-10 | Medium | Runtime DB user has ALL privileges; setup/root passwords live in the app process env |
| 11 | SEC-11 | Medium | PNG decompression bomb in PDF image decoder |
| 12 | SEC-12 | Medium | No HTTP security headers (CSP, frame-ancestors, nosniff, HSTS, Referrer-Policy) |
| 13 | SEC-13 | Medium | ~140 handlers return raw exception text (SQL, paths) to the client |
| 14 | SEC-14 | Medium | Vulnerable dependencies (markdown-it ReDoS reachable, nuxt, vue, mariadb, nodemailer…) |
| 15 | SEC-15 | Medium | Bank-statement linking ignores record status (draft/cancelled invoices forced to paid) |
| 16 | SEC-16 | Medium | Receipt amounts/positions editable after reimbursement/booking |
| 17 | SEC-17 | Medium | ICS calendar feed shows all events regardless of permissions; token minting ungated |
| 18 | SEC-18 | Medium | Login user enumeration (inactive-before-password, timing) |
| 19 | SEC-19 | Medium | `members.edit` can deactivate any user (incl. admin) via member status "left" |
| 20 | SEC-20 | Low–Med | Push subscription endpoint: blind SSRF + endpoint re-binding without proof of possession |
| 21 | SEC-21 | Low | Uploads trust client MIME/extension; downloads served `inline` without `nosniff`/sandbox |
| 22 | SEC-22 | Low | No locks on disbursed reimbursements / bank statements / cash counts (**Decision needed**) |
| 23 | SEC-23 | Low | Weak receipt/reimbursement validation, double-reimbursement race |
| 24 | SEC-24 | Low | Session hygiene (expired rows kept, calendar token never revoked, admin reset doesn't force change, no last-admin guard) |
| 25 | SEC-25 | Low | Password policy & bootstrap secrets (length only, 72-byte bcrypt limit, seeded admin, SESSION_SECRET placeholder) |
| 26 | SEC-26 | Low | CSRF hardening: Origin check, state-changing GET unsubscribe, `COOKIE_DOMAIN` caveat, `secure` flag source |
| 27 | SEC-27 | Low | External images in wiki/agenda (tracking pixels) |
| 28 | SEC-28 | Low | Email header/recipient handling (From quoting, multi-address member emails) |
| 29 | SEC-29 | Low | Smaller authorization gaps (bank-statement options, shift-plan attachment, notification delete, RSVP dates) |
| 30 | SEC-30 | Low | Kassensystem DB user over-privileged |
| 31 | SEC-31 | Low | Docker runtime hardening |
| 32 | SEC-32 | Low | Large exports / restore sessions held in memory |
| 33 | SEC-33 | Info | Misc robustness (see list at the end) |

---

## High

### SEC-01 — Privilege escalation via position assignment and account linking ✅
- [x] done

**Background:** effective permissions = roles ∪ `user_permissions` ∪ **permissions of all positions held by members whose `members.account = userId`** (`server/utils/permissions.ts:38-98`, `getUserPositionIds`). So whoever can write `member_positions` or `members.account` can grant permissions.

**Where**
- `server/api/members/[id].put.ts:56` — `account: body.account ?? null` written unconditionally (omitting `account` *clears* the link). No `users.manage` check, no "already linked elsewhere" check.
- `server/api/members/create.post.ts:44` — `body.account` accepted; only `new_account` requires `users.manage` (lines 46-48).
- `server/api/members/[id].put.ts:114-122`, `create.post.ts:~82` — `syncPositionAssignments` with `body.positions`, guarded only by `members.edit` (contrast: subdivisions are gated on `settings.subdivisions.manage`, lines 36-41).
- `server/api/positions/save.post.ts:56-73` (`settings.positions.manage`) — can add any member (incl. own) to any position.
- `db/init.sql` — `members.account` has an FK but **no UNIQUE** key; `assignMemberToUser`'s `MemberAlreadyLinkedError` (`server/utils/userAccounts.ts:86`) is bypassed by the paths above.

**Exploit:** user with only `members.edit` sends `PUT /api/members/<own id>` with a position whose `position_permissions` include `permissions.manage` → admin on next request. Variant: set `account = <own user id>` on the treasurer's member row → inherit their positions, organizer rights, and see their PII via `/api/members/self`.

**Fix**
1. `members/[id].put.ts` and `create.post.ts`: if `body.account` differs from `existing.account` (or is set on create), require `users.manage`, otherwise return an error. If `body.account` is `undefined`, keep `existing.account` (never null it implicitly). Route changes through `assignMemberToUser` so the "already linked" check applies.
2. Changing position assignments (add/remove/change of `position_id`) requires `permissions.manage` — **or** introduce a new permission `positions.assign` (follow CLAUDE.md "Permissions" checklist incl. `seed-admin.mjs`). Additionally refuse assigning a position whose permission set is not a subset of the caller's own permissions unless the caller has `permissions.manage`. Apply identically in `positions/save.post.ts` / `server/utils/positions.ts`. Diffing: compare incoming vs `existingPositionRows`; unchanged assignments must still save without the extra permission (members editors must keep editing other fields).
3. Add `UNIQUE KEY uq_members_account (account)` — migration must first report/resolve duplicates (fail loudly listing duplicate member ids rather than auto-deleting). Follow the full migration checklist in CLAUDE.md.
4. Client: hide/disable the account and position editors in the member form when the user lacks the new permission(s) (`hasPermission`).
5. Tests (`tests/db/`): members.edit-only user cannot add a privileged position, cannot change `account`, can still edit name/address; omitted `account` keeps the link.

### SEC-02 — Arbitrary file IDs can be attached → per-record file access bypass ✅
- [x] done

**Where**
- `server/utils/attachments.ts:26-42` (`normalizeAttachmentSelection` only checks positive ints) and `:223-233` (`saveAttachmentSelection` inserts any new `fileIds` into `file_attachments`).
- Callers that never check readability:
  - `server/api/wiki/articles/[id]/attachments.put.ts:24-29` (`wiki.view` + article write access, which wiki ACLs can grant per article).
  - `server/api/notifications/create.post.ts:58` → `server/utils/notifications/enqueue.ts:87-88` (`notifications.send`).
  - `server/api/settings/notifications.test-notification.post.ts:121-151` — `loadMailAttachments` **emails the raw bytes** to the caller.
  - `server/api/settings/notifications.save.post.ts` → `normalizeTemplateAttachments` (`server/utils/notifications/settings.ts:160-165`) — template `fileIds` stored in JSON setting without FK; `mayReadAsTemplateAttachment` (`server/utils/fileAccess.ts:94-113`) then grants read to template managers **and every past recipient of that notification type**.
- `loadAttachmentItems` (`attachments.ts:154-176`) echoes `original_name`/size for any submitted id → filename enumeration.

**Exploit:** a user with write access to one wiki article PUTs `{"attachments":{"fileIds":[1..10]}}` repeatedly → every receipt/invoice/reimbursement scan (IBANs) becomes readable through `mayReadWikiArticle` for them and all article readers. Same with `notifications.send` sending to oneself.

**Fix**
1. Add `assertAttachableFiles(event, user, newFileIds, conn?)` in `server/utils/attachments.ts` (or `fileAccess.ts`): for every **newly added** id (not already attached to this entity), require the file to exist and `canReadFile(...)` to be true; return `{ ok:false, error }` listing nothing about the files themselves (generic message).
2. Call it in all four callers above *before* any write (and before `loadMailAttachments`). Better: make `saveAttachmentSelection` take the acting user and enforce it centrally, keeping the `userId === null` system path unchanged.
3. `normalizeTemplateAttachments`: same check for added ids + existence check.
4. `loadAttachmentItems` should only return items that were actually saved/readable.
5. Tests (`tests/db/`): user without `receipts.view` cannot attach a receipt file to a wiki article / notification; already-attached ids still save; system path unaffected.

### SEC-03 — `users.manage` can take over higher-privileged accounts
- [x] done

**Where:** `server/api/auth/admin-set-password.post.ts:25,42-52` (any user incl. admins), `server/api/auth/change-username.post.ts:26`, `server/api/auth/activate.post.ts:7`, `server/api/auth/link-member.post.ts:23,38` (link any user, incl. self, to an unlinked member → inherits positions, see SEC-01).

**Exploit:** a secretary with `users.manage` resets the admin's password and logs in as admin.

**Fix**
1. Helper `canManageUser(caller, targetUserId, conn)` in `server/utils/userAccounts.ts`: load target's effective permissions (`getUserRoleIds`/`getUserPositionIds`/`getUserPermissions`); refuse if the target holds any permission the caller lacks (simplest acceptable rule: target has `permissions.manage` or `users.manage` and caller lacks `permissions.manage` → refuse).
2. Use it in admin-set-password, change-username, activate (deactivate), link-member. In link-member/register also refuse linking a member whose active positions carry permissions beyond the caller's.
3. `admin-set-password`: also `SET must_change_password = 1` (see SEC-24).
4. Tests: `users.manage`-only user cannot reset an admin's password; can reset a plain user's.

### SEC-04 — No brute-force protection on login
- [x] done

**Where:** `server/api/auth/login.post.ts:28-61`; no rate limit / lockout / attempt logging anywhere. bcrypt cost 12 (`server/utils/auth.ts:26`) on libuv's 4-thread pool → ~20 req/s for an existing username saturate crypto/fs for the whole server.

**Fix**
1. `server/utils/rateLimit.ts`: in-memory sliding window / token bucket keyed by IP and by lower-cased username (single-instance deployment; document that multi-instance would need a DB table). Suggested: 5 failures / 15 min per username → temporary lock with exponential backoff; 30 attempts / min per IP.
2. Apply in `login.post.ts` *before* `bcrypt.compare`. Locked → same generic `invalid_credentials`-style response with a `code: 'rate_limited'` (add i18n key) and HTTP status 429 via `setResponseStatus`.
3. Also apply a looser IP limit to unauthenticated `/api/calendar/[token]`, `/api/public/*`, `/api/notifications/unsubscribe`.
4. Log failed logins (username, IP, time) via `console.warn` (no passwords).
5. Get the client IP via h3 `getRequestIP(event, { xForwardedFor: true })` only if a trusted proxy is configured — add env `TRUST_PROXY` (default false) and document it in `.env.example`.
6. Unit-test the limiter.

### SEC-05 — Database exposed with default credentials ✅
- [x] done

**Where:** `docker-compose.yml:63-64` (`"3308:3307"` on all interfaces), `:17-18,56,59,73` fallbacks `fsi_password` / `root_password`; `.env.example` ships `DB_PASSWORD=fsi_password`. Docker-published ports bypass host firewalls (ufw). `docker-compose.test.yml:15` publishes 3309 similarly.

**Fix**
1. `ports: ["127.0.0.1:3308:3307"]` (and `127.0.0.1:3309:...` in the test compose).
2. Replace `${X:-default}` password fallbacks with `${X:?X must be set}` in `docker-compose.yml` (keep defaults in the *test* compose — it's throwaway — but bind it to localhost).
3. Set `MARIADB_ROOT_HOST=localhost` on the db service.
4. Same for the app port `3002` if it's always behind a reverse proxy (document; don't silently break existing deployments — mention in the commit message).

> **Note (implementation):** `MARIADB_ROOT_HOST=localhost` was **not** set. The setup scripts (migrations, `create-*-db-user.mjs`) connect as `root` from the `migrate` container over the Docker network (`DB_AUDIT_SETUP_USER=root`), which a localhost-only root would break on fresh installs (the variable only applies when the volume is first initialised). Doing it needs a dedicated, network-reachable setup user with `CREATE USER`/`GRANT` rights first — open for the owner. App port 3002 left unchanged (owner decision).

---

## Medium

### SEC-06 — Transactions commit on `{ ok:false }` returns ✅
- [x] done

**Where:** `server/utils/db.ts:40-80` — `withTransaction` / `withAuditTransaction` commit whenever the callback *returns*; they only roll back on throw. Handlers commonly `return { ok:false }` from inside after writing. Confirmed cases:
- `server/api/bank_statements/[id].put.ts:173-191` — file-required / `validateUploadedFile` checks run **after** header, positions and linked receipt/invoice status writes → an invalid/removed file returns an error but everything else (incl. removing the statement's only file) is committed.
- `server/api/cash_counts/[id].put.ts:139-144` — same pattern.
- `server/api/receipts/[id].put.ts:82-99` then `118/131` — header (incl. status) committed when sphere/cost-centre validation fails.
- `server/api/members/[id].put.ts:76-98` then `122, 136-143`.
- `server/api/positions/save.post.ts:50-55` then `73`.
- `server/api/invoices/[id].put.ts:364,373,376` (mostly unreachable today).

**Fix (global, preferred):** in both helpers, after `callback` returns, if the result is an object with `ok === false`, **roll back** and return the result instead of committing:
```ts
const result = await callback(conn)
if (result && typeof result === 'object' && (result as any).ok === false) {
  await conn.rollback()
  return normalizeBigInt(result)
}
await conn.commit()
```
Then grep all `withTransaction`/`withAuditTransaction` callers for any that *intentionally* return `ok:false` after a write they want kept (unlikely; if found, restructure them). Also check callers that store files to disk inside the transaction (`storeAndAttachUploadedFile`) — the DB rows roll back; leftover disk files are acceptable (see SEC-33) but note it.
**Tests (`tests/db/`):** a bank statement PUT with `removeExistingFile=true` and no file leaves DB unchanged; a receipt PUT with invalid cost centre leaves status unchanged; a callback returning `{ok:false}` after an INSERT leaves no row.

### SEC-07 — Unbounded request bodies ✅
- [x] done

**Where:** `server/utils/api/request.ts:74` (`readRawBody` buffers the whole multipart body; `MAX_UPLOAD_MB` checked only afterwards in `server/utils/files.ts:27` and `server/utils/wiki/images.ts:24`); `readBody` everywhere incl. unauthenticated `login.post.ts:30`. h3/Nitro set no limit. `attachments/upload.post.ts` only does `requireAuth` before reading. JSON arrays (positions, shifts, tasks, memberIds…) have no length caps.

**Fix**
1. `server/middleware/body-limit.ts`: for non-GET `/api/**`, reject with 413 if `content-length` > limit: `MAX_UPLOAD_MB` + 1 MB for multipart, larger dedicated limit for `settings/app/snapshot.restore`/`snapshot.preview`/`files-preview` (check their actual needs), ~2 MB for everything else. Also reject chunked bodies without content-length on non-multipart routes, or count bytes on the stream and abort.
2. In `readMultipart`, re-check the size defensively.
3. Add `.length` caps in normalizers for array payloads (e.g. ≤ 500 positions, ≤ 1000 member ids) with German error messages.
4. Document `client_max_body_size` for the reverse proxy in README/.env.example.

### SEC-08 — No path containment for stored files
- [x] done

**Where (all `path.join(UPLOAD_DIR, file_path.replace(/^\/uploads\//, ''))` with no check):** `server/api/files/[id].get.ts:46-48`, `server/utils/attachments.ts:282`, `server/utils/documentExport/engine.ts:124`, `server/utils/wiki/images.ts:157` (**unlink**) and `:189`, `server/api/settings/association/logo.get.ts:33-34`. Containment is only checked in `settings/app/files.get.ts:99` and `databaseSnapshots.ts:750-754` (the latter only for files present in the archive).

**Exploit:** a restored snapshot (SEC-09) with a `files` row `file_path = "/uploads/../../app/.env"` → `GET /api/files/<id>` returns all secrets; a matching wiki image row lets the attacker delete arbitrary files.

**Fix**
1. `resolveStoredFilePath(filePath): string | null` in `server/utils/files.ts`: `path.resolve(UPLOAD_DIR, rel)` and require it to start with `root.endsWith(path.sep) ? root : root + path.sep` (also fixes SEC-33 `UPLOAD_DIR=/`). Return null otherwise.
2. Use it at every site above; null → treat as "file not found".
3. In snapshot validation, require every `files.file_path` to match `^/uploads/[A-Za-z0-9_-]+/[0-9a-f-]{36}(\.[a-z0-9]{1,5})?$` (check the real format produced by `storeUploadedFile` first).
4. Unit test the helper with `..`, absolute paths, Windows separators.

### SEC-09 — Snapshot restore is unaudited and can forge history
- [x] done — **Decision needed** on signing policy

**Where:** `server/utils/databaseSnapshots.ts:677-729` (via `server/api/settings/app/snapshot.restore.post.ts`): `withTransaction` (no actor), DELETEs every table incl. `users`, `role_permissions`, `entity_versions` and re-inserts from the archive; integrity is optional (`:680`) and an unkeyed SHA-256 (`:599-608`). Identifiers are whitelisted and values parameterized (no SQLi). Restore tokens (`snapshotRestoreSessions.ts`) aren't bound to the previewing user.

**Fix**
1. Require password re-entry for restore (verify against caller's `password_hash`).
2. After restore, write a persistent record that survives the restore: e.g. a dedicated `system_events` table excluded from snapshots, plus `console.warn` with actor id and snapshot checksum.
3. Sign snapshots with HMAC-SHA256 keyed by a server secret (new env `SNAPSHOT_SIGNING_KEY`, falling back to a key derived from `SESSION_SECRET`); refuse unsigned/foreign snapshots unless an explicit "foreign snapshot" confirmation flag is sent (**owner decides** whether foreign restores must remain possible, e.g. for migration between servers).
4. Bind restore token to `user.id`; one active session per user.
5. Document in the settings UI that this permission is equivalent to full DB admin.

### SEC-10 — Runtime DB user is all-powerful; privileged creds in app env
- [x] done — **Decision needed** (deployment change)

**Where:** `docker-compose.yml` db service (`MARIADB_USER` gets `ALL ON fsi_buchhaltung.*`), same user is runtime `DB_USER` (`server/utils/db.ts:7-17`); `docker-compose.yml:9` `env_file: .env` and `:18` put `DB_ROOT_PASSWORD` and `DB_AUDIT_SETUP_*` into the long-running Nitro process. The runtime user can `DROP TRIGGER` and edit `entity_versions`. (`@audit_user_id` is only set parameterized in `server/utils/dbAudit.ts:138` — no injection path today; this is defense in depth.)

**Fix**
1. New migration script that creates/updates a restricted runtime user: `SELECT, INSERT, UPDATE, DELETE` on app tables; `SELECT` (+ `DELETE` only if in-app pruning exists — check `entity_versions` deletion paths such as `server/utils/entityVersions.ts:157` and snapshot restore) on `entity_versions`; no `TRIGGER/ALTER/DROP/CREATE/SUPER`. Triggers run as DEFINER (setup user) so audit inserts keep working — verify with `npm run test:db`.
2. Run migrations in a separate one-shot compose service so the app container doesn't receive root/setup passwords.
3. Note: snapshot restore deletes/inserts `entity_versions` — interacts with SEC-09; decide together.

> **Note (implementation):** the runtime user gets `SELECT, INSERT, DELETE` (no `UPDATE`) on `entity_versions`, because snapshot restore replaces the table and the retention job prunes it. It can no longer drop/alter triggers or tables (verified against the test DB). Fully read-only audit history would require restore and pruning to run with separate credentials.

### SEC-11 — PNG decompression bomb
- [x] done

**Where:** `server/utils/pdf.ts:541-578` (`buildPngImageObject`): width/height uncapped, `inflateSync` without `maxOutputLength`. Reachable via wiki images (`bild:<id>`) in article/space PDF export and via the association logo in every PDF.

**Fix:** reject if `width * height > 40_000_000` or either dimension > 20000 before inflating; pass `{ maxOutputLength: (stride + 1) * height }`. Also check dimensions at upload in `validateWikiImage` and logo upload. Unit test with a crafted IHDR.

### SEC-12 — No HTTP security headers
- [x] done

**Where:** nothing in `nuxt.config.ts`, no `server/middleware/`.

**Fix**
1. Add `nitro.routeRules['/**'].headers` (or a Nitro plugin/middleware — note SEC-14: nuxt < 4.6.3 has a routeRules case-variant bypass, so upgrade first or use middleware): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=31536000` (only when served over HTTPS — make it env-conditional).
2. CSP: start with `Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'`. Test the app (PWA, service worker, icons from `@nuxt/icon` — may need `connect-src` for the iconify API unless icons are bundled), then switch to enforcing. Respect `APP_BASE_URL` subpath.
3. `/api/files/[id]` and `logo.get.ts`: add `Content-Security-Policy: sandbox; default-src 'none'` and `nosniff` (see SEC-21).

### SEC-13 — Raw exception text returned to clients ✅
- [x] done

**Where:** ~140 occurrences of `` error: `… ${err}` `` in `server/api/**` (e.g. `receipts/create.post.ts:110`, `invoices/[id].put.ts:396`, `permissions/users.update.post.ts:126`, `auth/activate.post.ts:25`, `auth/register.post.ts:57` returns `err.code`), plus `createError({ message: err })` in `files/[id].get.ts:62` and `settings/association/logo.get.ts:45`. mariadb `SqlError` includes SQL text; fs errors include server paths.

**Fix:** add `internalError(context: string, err: unknown): { ok:false, error:string }` in `server/utils/api/` that `console.error`s the full error and returns `{ ok:false, error: context }` (generic German message). Mechanically replace all occurrences (`grep -rn '\${err' server/api`). Keep intentional, user-facing validation messages unchanged. Optionally add a `conventions.spec.ts` rule forbidding `${err` in `server/api/**`.

### SEC-14 — Vulnerable dependencies ✅ (markdown-it 15.0.0 confirmed)
- [x] done

`npm audit --omit=dev`: 3 critical, 16 high, 15 moderate, 4 low (all with fixes). Runtime-relevant:
- **markdown-it 15.0.0** — ReDoS/linkify DoS (GHSA-253c-mchw-3w2r etc.), directly reachable: `server/utils/wiki/render.ts:335` uses `linkify: true`, `MAX_MARKDOWN_LENGTH = 200_000`. Upgrade to latest 15.x.
- **nuxt 4.5.2** (→ ≥4.6.3; routeRules case bypass), **vue 3.5.41** (→ ≥3.5.42), devalue/seroval/undici via nuxt.
- **mariadb 3.4.5** (→ latest 3.x; SQLi variants need configs not used here — upgrade anyway).
- **nodemailer 9.0.5** (→ ≥10.1.4, major; addressparser issues relate to SEC-28 — check API changes).
- **sanitize-html 2.17.7** (→ ≥2.18.1; advisories not reachable with the current allowlist).
- Dev tooling (simple-git, shell-quote, vite, esbuild, …) — `npm audit fix`.

**Fix:** `npm update nuxt vue markdown-it mariadb sanitize-html`, evaluate nodemailer 10 separately, `npm audit fix`, then `npm run test:all` and `npm run build`. Do not use `npm audit fix --force` blindly.

### SEC-15 — Bank-statement linking ignores record status
- [x] done

**Where:** `server/utils/bankStatements.ts:70-83` (`validateBankStatementRelations`), `server/api/bank_statements/create.post.ts:74-91`, `[id].put.ts:128-165`. Any invoice (draft, cancelled) is forced to `paid` with `paid_at` — skipping `materializeFinalInvoiceTexts`/PDF regeneration, after which the invoice is edit-locked. Any receipt (draft, cancelled, without file) is accepted. Removing a position hard-resets the record to `open`.

**Fix:** only allow invoices with `status IN ('open','paid')` and receipts with `status IN ('open','paid')` and an active file (check how "has file" is determined elsewhere, e.g. `receiptRequiresFile`). On removal, restore the previous status (store it in `bank_statement_positions` via migration, or recompute) instead of `open`. Tests in `tests/db/`.

### SEC-16 — Receipt money fields editable after reimbursement/booking
- [x] done

**Where:** `server/api/receipts/[id].put.ts:66-70` locks only `status` while `reimbursement_positions`/`bank_statement_positions` reference the receipt; positions, amounts, company, date remain editable (`:82-184`) and totals recompute live.

**Fix:** when `statusLocked`, reject changes to positions (amount/tax/sphere/cost centre), company, date and number (compare with existing; mirror `invoices/[id].put.ts:146-148`). Allow description/notes and file replacement only if the owner wants (keep file replacement allowed by default). Update the form to render locked fields readonly (`Form.vue`) and add i18n error key.

### SEC-17 — ICS feed ignores event permissions
- [x] done

**Where:** `server/api/calendar/[token].get.ts:100-104` calls `loadCalendarEvents(null)` → all events incl. organizer names, regardless of permissions (in-app `server/api/calendar/entries.get.ts:51-58` requires `events.access`/`events.view`/`events.shifts.signup` and `calendar.view`). `server/api/user/calendar-feed.get.ts:18` / `.post.ts:19` use `getCurrentUserFromEvent` directly → no `calendar.view` check and bypass of `must_change_password`.

**Fix:** in the feed, compute the same `canSeeEvents`/shift/task flags as `entries.get.ts` from the already-loaded permissions (extract a shared helper so both stay in sync) and return an empty calendar without `calendar.view`. Gate `calendar-feed.get/post` with `requirePermission(event, 'calendar.view')`. Test in `tests/db/`.

### SEC-18 — Login user enumeration ✅
- [x] done

**Where:** `server/api/auth/login.post.ts:39` (unknown user → immediate return, no bcrypt), `:43` (`inactive_user` returned before password check).

**Fix:** if no row, `await comparePassword(password, DUMMY_HASH)` (a constant bcrypt-12 hash generated once at module load) and return `invalid_credentials`. Check password first; only then check `is_active` (returning `inactive_user` only after a correct password is acceptable). Do this together with SEC-04.

### SEC-19 — `members.edit` can deactivate any user ✅
- [x] done

**Where:** `server/api/members/[id].put.ts:162-175` passes `accountId: body.account ?? existing.account` to `applyMemberStatusActions` → `deactivateLinkedAccount` (`server/utils/members.ts:88-118`, `UPDATE users SET is_active = 0`).

**Fix:** use only the persisted link (`existing.account`, after SEC-01 changes possibly the newly validated one) — never raw `body.account`. Require `users.manage` + `canManageUser` (SEC-03) for the deactivation side effect; without it, skip deactivation and report it in `status_actions` so the UI can tell the user. Never deactivate the caller themselves or the last `permissions.manage` holder (SEC-24).

---

## Low

### SEC-20 — Push subscriptions: SSRF, re-binding
- [x] done

> **Owner decision:** the **only** automatic removal of push subscriptions is when a user is **deactivated** — then delete all of that user's `notification_push_subscriptions` rows (inside the same audit transaction as the deactivation; this covers `auth/activate.post.ts` and the member-"left" path `deactivateLinkedAccount` in `server/utils/members.ts`). Nothing else may remove them: not logout, logout-all, password change, admin password reset, send failures or the endpoint allowlist below. Getting people to enable push is hard; the subscription must survive. The user's own explicit opt-out in the notification preferences stays as it is. The accepted trade-off: on a shared device, notifications of the last user who enabled push there keep arriving after logout.

**Where:** `server/api/notifications/push-subscribe.post.ts:15-27` accepts any endpoint string; `server/utils/notifications/channels/push.ts:47,79-81` POSTs to it (HTTPS only via web-push; errors land in `notification_deliveries.error` → internal port scanning). `ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)` (`:25`) lets anyone who knows an endpoint URL re-bind it to their own account.

**Fix**
1. Validate endpoint: `https:` only, host allowlist (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`), no IP literals; make the allowlist overridable via env. Existing rows with non-matching endpoints: skip them at send time (log a warning), do **not** delete them.
2. Re-binding: keep the behaviour that a device moves to whoever subscribes on it (that's legitimate — a different user logging in on the same device re-subscribes). Only require proof of possession: when an existing row for the endpoint belongs to another user, re-bind only if the submitted `keys.p256dh` and `keys.auth` match the stored ones (only the real browser has them); otherwise reject without changing the row.
3. Store only a generic error string in `notification_deliveries.error`.
4. On user deactivation (both paths named above), delete that user's push subscriptions. Additionally make dispatch skip inactive users at send time as a safety net. A reactivated user has to re-enable push on their device.
5. Test (`tests/db/`): deactivation removes the user's subscriptions; logout / logout-all / password change leave them untouched.

### SEC-21 — Upload type trust & inline serving
- [x] done

**Where:** `server/utils/files.ts:26,41-42,54-55` (MIME and extension from client; only wiki images sniff bytes, `server/utils/wiki/images.ts:14`); `server/api/files/[id].get.ts:54-58` and `logo.get.ts:38-41` serve `inline` with stored MIME, no `nosniff`.

**Fix:** sniff magic bytes (`%PDF-`, PNG, JPEG — reuse `sniffWikiImageType`) in `validateUploadedFile`, store the sniffed MIME, derive the extension from it. On download add `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, and RFC 5987 `filename*` encoding. Unit tests for the sniffer.

### SEC-22 — No locks on disbursed reimbursements / bank statements / cash counts
- [x] done — **Decision needed**

`reimbursements/[id].put.ts` (after `disbursed_at`), `bank_statements/[id].put.ts`, `cash_counts/[id].put.ts` allow full edits forever; only the audit log protects them. Propose to the owner: once disbursed/booked, allow only corrective fields or require a new `*.unlock` permission. Do not implement without confirmation.

### SEC-23 — Receipt/reimbursement validation & race
- [x] done

- `server/utils/receipts.ts:3-13`: `status` free text (validate against `ReceiptStatus` enum), `amount` not `Number.isFinite`, tax range unchecked (TINYINT), positions length uncapped; `JSON.parse` outside try (`receipts/create.post.ts:32`, `[id].put.ts:42`; same in invoices, reimbursements, bank_statements, cash_counts create/PUT) → 500s instead of `{ok:false}`. `normalizeInvoicePayload` (`server/utils/invoices.ts:74`) calls `.map`/`.trim` on unchecked types.
- No `UNIQUE(receipt_id)` on `reimbursement_positions` (`db/init.sql:508-514`); check-then-insert → concurrent double reimbursement. Add unique key via migration (check duplicates first) and/or `SELECT … FOR UPDATE`.
- `reimbursements/[id].put.ts:154-166,196-201`: reject cancelled receipts; define what happens to removed receipts' status.

### SEC-24 — Session & account hygiene
- [x] done

- `server/utils/sessionGuard.ts:38-40`: expired branch doesn't `deleteSessionByToken`; `cleanupExpiredSessions()` only runs on logout → call it on login too (or a Nitro scheduled task), and delete sessions idle beyond the inactivity limit.
- `server/utils/calendarToken.ts`: clear `calendar_token_hash` on password change, admin password reset; add a revoke endpoint (`DELETE /api/user/calendar-feed`) + UI button.
- `admin-set-password.post.ts:43`: set `must_change_password = 1`.
- No last-admin guard: `auth/activate.post.ts`, `permissions/users.update.post.ts`, `permissions/roles.save.post.ts:63-69`, `permissions/roles.set_permissions.post.ts`, `positions.set_permissions.post.ts` → inside the transaction, refuse any change leaving zero active users with effective `permissions.manage` (helper in `server/utils/permissions.ts`; test in `tests/db/`).

### SEC-25 — Password policy & bootstrap secrets
- [x] done

- `config/validation.ts` `MIN_PASSWORD_LENGTH = 8` → raise to 10–12; reject passwords > 72 bytes UTF-8 (bcrypt truncation) in all four places (`change-password`, `admin-set-password`, `register`, `userAccounts.ts:46`); i18n messages.
- `scripts/seed-admin.mjs:159-162`: set `must_change_password = 1` on the created admin; refuse `ADMIN_PASSWORD` shorter than the minimum or equal to `change_me_admin`.
- `server/utils/auth.ts:12`: in production refuse to start if `SESSION_SECRET` < 32 chars or equals `replace_me_with_random`/`dev_change_me`; `docker-compose.yml:25` remove the `dev_change_me` fallback.

### SEC-26 — CSRF hardening & cookie details
- [x] done

Current state is decent: cookie `httpOnly`, `sameSite: 'strict'`, mutations are POST/PUT/DELETE.
- Add `server/middleware/origin-check.ts`: for non-GET/HEAD `/api/**` (except `/api/public/**`), reject when `Origin` (or `Sec-Fetch-Site` = `cross-site`/`same-site`) doesn't match the app origin. Important because `COOKIE_DOMAIN` (SSO with kassensystem) makes sibling subdomains same-site.
- `server/api/notifications/unsubscribe.get.ts`: make GET render a confirmation page with a POST form; do the update in a POST handler; optionally RFC 8058 `List-Unsubscribe-Post` header in `email.ts`.
- `login.post.ts:54-61`: derive `secure` from an explicit `COOKIE_SECURE` env (default: true when `NODE_ENV=production`), set cookie `path` to `APP_BASE_URL`; same attributes in `logout*.post.ts`. Document the `COOKIE_DOMAIN` trust implication in `.env.example`.

### SEC-27 — External images in wiki/agenda
- [x] done

`server/utils/wiki/render.ts:370` falls back to the default image renderer for non-`bild:` srcs; sanitizer allows `img src` http/https (`:417,421`). Also agendas (`server/utils/appointments/index.ts:147`). → Only allow `bild:` images (render `escape(alt)` or push a validation error otherwise); restrict `allowedSchemesByTag.img`. Check existing content won't break silently (maybe surface a validation error on save/publish rather than dropping on render). Unit test in the wiki render specs.

### SEC-28 — Email header/recipient handling
- [x] done

- `server/utils/notifications/channels/email.ts:53`: use `from: { name: fromName, address: SMTP_FROM }` instead of string interpolation.
- Member emails aren't validated server-side (`server/utils/members.ts` `validateMemberPayload`, `server/utils/memberSelfEdit.ts:88-97`) → a single-address check (no `,;<>` or whitespace) plus length caps; in `recipients.ts`/`email.ts` pass `to: { address }`.
- Self-edit values: only "non-empty string" checks → reuse per-field validators from `validateMemberPayload` with length caps; avoid returning raw `err.code` (`members/self/update.post.ts:44`, see SEC-13).

### SEC-29 — Smaller authorization gaps
- [x] done

- `server/api/bank_statements/options.get.ts:21`: guarded by `.view`, lists all unlinked receipts/invoices incl. drafts → require `bank_statements.edit`. (Also bug: `erloese: Number(e.erloese)` is NaN — column not selected.)
- `server/api/notifications/create.post.ts:39-45`: `shiftPlan` attachment for any event → require `events.view` or organizer of that event.
- `server/api/notifications/[id].delete.ts`: `notifications.send` can cancel any scheduled notification incl. system ones → restrict to own (`created_by`) unless `settings.notifications.manage` (**confirm with owner**).
- `server/api/appointments/[id]/respond.post.ts:46-48,77`: validate `occurrenceDate` against `expandOccurrences`.
- `server/api/audit/index.get.ts:36`: `limit=abc` → `LIMIT NaN` SQL error → `Number.isFinite` fallback.
- `server/utils/audit/log.ts:672-675`: reject `;column=value` literals and scope columns that are in `redactedColumns`.
- `members/pending-changes/[id].post.ts`: verify whether an approver can approve their own pending change; if so, decide with owner whether to forbid.

### SEC-30 — Kassensystem DB user over-privileged
- [x] done

`scripts/create-connection-db-user.mjs:20-28,67-73`: `SELECT` on whole `users` (password hashes, token hashes) and full DML on `sessions`. → column-level grant `SELECT (id, username, is_active, must_change_password) ON users` (check what the kassensystem actually reads first). Document that sharing `SESSION_SECRET` + `sessions` write access makes the kassensystem fully trusted.

### SEC-31 — Docker runtime hardening
- [ ] skipped — owner decision (no Dockerfile/runtime change)

`docker-compose.yml:3-6,46`: `node:22-alpine` as root, `.:/app` RW bind mount, `npm ci && build` on every start. → multi-stage Dockerfile, run `.output` as `USER node`, no source mount, migrations as separate job (ties into SEC-10). Propose; don't silently change the production workflow.

### SEC-32 — Memory-heavy exports & restore sessions
- [x] done

`server/utils/documentExport/engine.ts:98-133`, `zip.ts:33-87`: up to `MAX_DOCUMENT_EXPORT_BYTES = 250 MB` (`shared/documentExport.ts:53`) in RAM per request → lower the limit and add a per-user concurrency limit of 1. `server/utils/snapshotRestoreSessions.ts:12,24`: uncapped sessions → max one per user; `scryptSync` blocks the event loop → use async `scrypt`.

---

## SEC-33 — Info / robustness (do last, batch together)
- [x] done

- `.env.example:59` `UPLOAD_DIR=/` → `./uploads`; containment prefix bug fixed by SEC-08 helper. `.env.example:13-14` mismatching `DB_AUDIT_SETUP_PASSWORD` vs `DB_ROOT_PASSWORD` → align.
- `components/PageRenderer.vue:53`: `PAGES[currentPage]` with hash `#constructor`/`#__proto__` → crash; use `Object.hasOwn(PAGES, name)`. Check `usePage`/hash parsing for the same.
- `server/utils/notifications/render.ts:136-140`: sequential placeholder replacement expands `{x}` inside values → single-pass regex replace.
- `components/Page/Wiki/Navigation/SearchPanel.vue:165`: highlight regex runs over escaped text, breaks entities for queries like `amp` → highlight on raw text, escape segments.
- `server/utils/wiki/render.ts:415`: prefix heading slugs (`wiki-…`) to avoid DOM clobbering with app ids.
- `server/utils/wiki/detail.ts:204`: cached `content_html` served without re-sanitizing → sanitize on read or version the renderer.
- `components/Page/Wiki/Article/ToolLink.vue:61-73` / `render.ts:168-191`: wiki tool links pass arbitrary `meta` to `setPage` → allowlist meta keys per page.
- `server/utils/files.ts:45`: files written to disk before DB insert; rolled-back transactions and deleted records leave orphans → periodic cleanup job (optional).
- Snapshot restore re-activates revoked API keys / old password hashes / calendar tokens → document or exclude token tables.
- `server/utils/xlsx.ts:320`: `&` in association name interpreted as Excel footer code; XML-invalid control chars not stripped from cells.
- `server/utils/notifications/channels/email.ts:45-46`: with `APP_BASE_URL=/` the unsubscribe link is relative → add an absolute public URL setting.
- Config, not code: default `user` role in `scripts/seed-admin.mjs:96-109` has `reimbursements.view` → every user sees all reimbursement IBANs. Raise with the owner.

> **Implementation notes (SEC-33):** done except: heading slugs were **not** prefixed (`wiki-…`) — it would break existing deep links and the stored TOC/anchor pairing; the orphan-file cleanup job (optional) was not built. Snapshot restore re-activates revoked API keys / old password hashes / calendar tokens by design (it restores the whole DB) — restores are now password-confirmed, signed and logged (SEC-09). `reimbursements.view` was removed from the default role in `seed-admin.mjs` only; existing installs keep it until an admin removes it.

---

## Verified as OK (don't "fix" these)

- **SQL injection:** all queries parameterized; dynamic identifiers (`toggle.ts` tables, audit registry tables/columns, self-edit field names, snapshot table/column names) come from constants/whitelists/live schema. `IN (…)` lists use generated placeholders.
- **XSS:** every `v-html` sink is safe today — notification renderer escapes first and only emits fixed tags; wiki/agenda use markdown-it `html:false` + strict sanitize-html allowlist (http/https/mailto, no protocol-relative); search highlight escapes all five chars; no `innerHTML`/`eval`/`new Function` anywhere. ICS fields escaped (`escapeIcsText`). PDFs contain no JS/URI actions.
- **Sessions:** 256-bit random tokens, HMAC-SHA256 at rest; expiry + inactivity + `is_active` checked every request; permissions recomputed per request; password change kills other sessions; no session fixation. Same token scheme for API keys, calendar and unsubscribe tokens.
- **"View as"** is client-side only and clamped to the user's real permissions.
- **Cash register proxy** (`server/utils/cashRegisterApi.ts`): fixed base URL, numeric event id, filter keys validated, `URLSearchParams`, key stays server-side.
- **File access registry:** default-deny; all `entity_type`s used are registered. `/api/attachments/files` correctly filters by `canReadFile`.
- **Service worker:** precaches only static assets, no API caching; push click URL is server-built (no open redirect).
- **IDOR on self-service routes** (inbox, read, shift self-signup, task status, checklist done, appointment respond): all scoped to the caller.
- **Exports:** XLSX cells written as `inlineStr` (no formula injection); ZIP entry names sanitized; download filenames sanitized.
- **Audit actor variable** only set via parameterized `SET` and cleared before releasing the connection.
