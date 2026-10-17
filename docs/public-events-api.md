# Public events & appointments API (for the website)

Read-only feeds of the events marked **„Auf der Website veröffentlichen“** in the event's *Website*
tab and of the appointments (Termine) marked the same way in the appointment editor. Everything else —
unpublished entries, members, cost centres, shifts, tasks, agendas, responses — never leaves the app.
Both endpoints use the same API keys.

## Authentication

Create a key under **Einstellungen → App → API-Schlüssel** (permission `settings.apiKeys.manage`). The key is
shown once; only an HMAC of it is stored. Send it from the website's **server** (never from browser
JavaScript):

```
Authorization: Bearer fsi_…
```

`X-API-Key: fsi_…` works as well. A missing, unknown or revoked key returns `401`.

## Request

```
GET {APP_BASE_URL}/api/public/events
```

| Parameter | Format | Default | Meaning |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | – | Events that end on/after this day. Without it: only events that have not ended yet. |
| `to` | `YYYY-MM-DD` | – | Events that start on/before this day (inclusive). |
| `limit` | integer | `100` | Max. number of events, capped at `500`. |
| `order` | `asc` \| `desc` | `asc` | Sort by start. Use `desc` for an archive. |

Days are calendar days in the app time zone (Settings → App). Invalid parameters return `400`.

An event appears only when it is published **and** its optional "Sichtbar ab" moment has passed.

## Response

```json
{
  "ok": true,
  "timeZone": "Europe/Berlin",
  "events": [
    {
      "id": 42,
      "title": "Sommerfest",
      "description": "Komm vorbei!\n\n- Live-Musik\n- **Grill**",
      "startsAt": "2026-07-01T18:00:00+02:00",
      "endsAt": "2026-07-02T01:00:00+02:00",
      "startsAtLocal": "2026-07-01 18:00:00",
      "endsAtLocal": "2026-07-02 01:00:00",
      "location": "Innenhof",
      "organizers": [{ "code": "FEST", "name": "Festausschuss" }]
    }
  ]
}
```

- `title` is the public title, or the internal name when none is set.
- `description` is **raw Markdown** (or `null`). Render it on the website and **sanitize the HTML**
  (e.g. markdown-it with `html: false`, or Parsedown in safe mode). The editor preview uses
  markdown-it with `html: false, linkify: true, breaks: true`.
- `startsAt`/`endsAt` are ISO 8601 with offset — parse these. The `…Local` fields are the same wall
  clock without offset, for display.
- `id` is stable and can be used for detail URLs or caching.

Errors have the shape `{ "ok": false, "error": "…" }` with a matching HTTP status.

## Appointments

```
GET {APP_BASE_URL}/api/public/appointments
```

Same authentication and parameters as the events feed (`from`, `to`, `limit`, `order`), with two
differences, because recurring series are expanded date by date and need a finite window: without
`to` the window ends **365 days after today** (or after `from`, if that lies in the future), and a
window longer than **10 years** (3660 days) is rejected with `400`. A `from` in the past therefore
adds past dates without cutting off the coming year. `limit` (default 100) applies as usual.

One entry per **occurrence**; a weekly meeting appears once per week. Publishing applies to the whole
series and has an optional "Sichtbar ab" moment like events.

```json
{
  "ok": true,
  "timeZone": "Europe/Berlin",
  "appointments": [
    {
      "id": "17-202611041900",
      "appointmentId": 17,
      "recurring": true,
      "title": "Offene Sitzung",
      "startsAt": "2026-11-04T19:00:00+01:00",
      "endsAt": "2026-11-04T21:00:00+01:00",
      "startsAtLocal": "2026-11-04 19:00:00",
      "endsAtLocal": "2026-11-04 21:00:00",
      "allDay": false,
      "location": "Raum 1",
      "cancelled": false
    }
  ]
}
```

- `id` is stable per occurrence (series id + its originally scheduled start), even if that one date
  was moved. `appointmentId` groups the occurrences of one series.
- `cancelled: true` marks a cancelled date (or a cancelled appointment) — show it as „fällt aus“
  rather than hiding it, or filter it out yourself.
- For `allDay` entries the local fields span `00:00:00` to `23:59:59`; use the date part only.
- There is no description: the agenda is internal and never published.

## Examples

```bash
curl -H "Authorization: Bearer $FSI_API_KEY" \
  "https://app.example.org/api/public/events?limit=10"
curl -H "Authorization: Bearer $FSI_API_KEY" \
  "https://app.example.org/api/public/appointments?to=2026-12-31"
```

```powershell
# In Windows PowerShell `curl` is Invoke-WebRequest — use Invoke-RestMethod (or curl.exe):
Invoke-RestMethod -Uri "http://localhost:3000/api/public/appointments" -Headers @{ Authorization = "Bearer $env:FSI_API_KEY" }
```

```php
$ctx = stream_context_create(['http' => ['header' => "Authorization: Bearer " . getenv('FSI_API_KEY')]]);
$data = json_decode(file_get_contents('https://app.example.org/api/public/events', false, $ctx), true);
```

Responses are sent with `Cache-Control: no-store`; if the website renders on every page view, cache
the result on the website side for a few minutes.
