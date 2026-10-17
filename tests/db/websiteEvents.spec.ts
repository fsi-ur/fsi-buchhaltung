import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApiKey, requireApiKey, revokeApiKey } from '~/server/utils/apiKeys'
import { query, withAuditTransaction } from '~/server/utils/db'
import { loadPublicEvents, parsePublicEventsQuery, saveEventWebsiteSettings } from '~/server/utils/eventWebsite'
import { auditRowsFor, resetDatabase } from '../helpers/db'
import { createEvent, createUser, resetFixtureCounter } from '../helpers/fixtures'

const ZONE = 'Europe/Berlin'
const NOW = '2026-10-17 12:00:00'

function requestWithHeaders(headers: Record<string, string>): H3Event {
  return {
    node: {
      req: { headers },
      res: { statusCode: 200, setHeader() {}, getHeader() { return undefined }, headersSent: false },
    },
  } as unknown as H3Event
}

function statusOf(event: H3Event) {
  return (event.node.res as any).statusCode
}

describe('API key authentication', () => {
  let actorId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
  })

  async function newKey(name = 'Website') {
    return withAuditTransaction({ id: actorId }, conn => createApiKey(name, actorId, conn))
  }

  it('accepts a valid key as Bearer token or X-API-Key header', async () => {
    const { id, key } = await newKey()

    expect(await requireApiKey(requestWithHeaders({ authorization: `Bearer ${key}` }))).toEqual({ ok: true, keyId: id })
    expect(await requireApiKey(requestWithHeaders({ 'x-api-key': key }))).toEqual({ ok: true, keyId: id })
  })

  it('stores only a hash and a short display prefix', async () => {
    const { id, key } = await newKey()
    const [row] = await query<any[]>('SELECT key_prefix, key_hash FROM api_keys WHERE id = ?', [id])

    expect(row.key_hash).not.toContain(key)
    expect(row.key_hash).toHaveLength(64)
    expect(key.startsWith(row.key_prefix)).toBe(true)
    expect(row.key_prefix.length).toBeLessThan(key.length / 4)
  })

  it('rejects missing, unknown and revoked keys with 401', async () => {
    const { id, key } = await newKey()

    const missing = requestWithHeaders({})
    expect((await requireApiKey(missing)).ok).toBe(false)
    expect(statusOf(missing)).toBe(401)

    const unknown = requestWithHeaders({ authorization: 'Bearer fsi_0000' })
    expect((await requireApiKey(unknown)).ok).toBe(false)
    expect(statusOf(unknown)).toBe(401)

    await withAuditTransaction({ id: actorId }, conn => revokeApiKey(id, conn))
    const revoked = requestWithHeaders({ authorization: `Bearer ${key}` })
    expect((await requireApiKey(revoked)).ok).toBe(false)
    expect(statusOf(revoked)).toBe(401)
  })

  it('records last use without adding audit noise', async () => {
    const { id, key } = await newKey()
    const before = (await auditRowsFor('api_keys', id)).length

    await requireApiKey(requestWithHeaders({ authorization: `Bearer ${key}` }))

    const [row] = await query<any[]>('SELECT last_used_at FROM api_keys WHERE id = ?', [id])
    expect(row.last_used_at).not.toBeNull()
    expect((await auditRowsFor('api_keys', id)).length).toBe(before)
  })
})

describe('public events', () => {
  let actorId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
  })

  async function publishedEvent(options: { name: string, startsAt: string, endsAt: string, published?: boolean, visibleFrom?: string | null, title?: string | null }) {
    const id = await createEvent({ name: options.name, startsAt: options.startsAt, endsAt: options.endsAt })
    await withAuditTransaction({ id: actorId }, conn => saveEventWebsiteSettings(id, {
      published: options.published ?? true,
      visible_from: options.visibleFrom ?? null,
      title: options.title ?? null,
      description: null,
    }, conn))
    return id
  }

  async function load(params: Record<string, unknown> = {}) {
    const parsed = parsePublicEventsQuery(params, NOW)
    if (!parsed.ok) throw new Error(parsed.error)
    return loadPublicEvents(parsed.query, NOW, ZONE)
  }

  it('returns only published, already visible events that have not ended', async () => {
    await publishedEvent({ name: 'Intern', startsAt: '2026-11-01 18:00:00', endsAt: '2026-11-01 22:00:00', published: false })
    await publishedEvent({ name: 'Vorbei', startsAt: '2026-10-01 18:00:00', endsAt: '2026-10-01 22:00:00' })
    await publishedEvent({ name: 'Geplant', startsAt: '2026-12-01 18:00:00', endsAt: '2026-12-01 22:00:00', visibleFrom: '2026-11-01 00:00:00' })
    await publishedEvent({ name: 'Läuft gerade', startsAt: '2026-10-17 10:00:00', endsAt: '2026-10-17 14:00:00' })
    await publishedEvent({ name: 'Bald', startsAt: '2026-11-05 18:00:00', endsAt: '2026-11-05 22:00:00', visibleFrom: '2026-10-17 11:00:00', title: 'Bald!' })

    expect((await load()).map(event => event.title)).toEqual(['Läuft gerade', 'Bald!'])
  })

  it('serves past events for an explicit date range, never the unpublished ones', async () => {
    await publishedEvent({ name: 'Januar', startsAt: '2026-01-10 18:00:00', endsAt: '2026-01-10 22:00:00' })
    await publishedEvent({ name: 'Januar intern', startsAt: '2026-01-11 18:00:00', endsAt: '2026-01-11 22:00:00', published: false })
    await publishedEvent({ name: 'Februar', startsAt: '2026-02-01 00:00:00', endsAt: '2026-02-01 02:00:00' })

    expect((await load({ from: '2026-01-01', to: '2026-01-31', order: 'desc' })).map(event => event.title)).toEqual(['Januar'])
  })

  it('exposes organising subdivisions but no member data', async () => {
    const eventId = await publishedEvent({ name: 'Fest', startsAt: '2026-11-01 18:00:00', endsAt: '2026-11-01 22:00:00' })
    const sub = await query<any>('INSERT INTO subdivisions (code, name) VALUES (?, ?)', ['FEST', 'Festausschuss'])
    await query('INSERT INTO event_subdivision_organizers (event_id, subdivision_id) VALUES (?, ?)', [eventId, Number(sub.insertId)])

    const [event] = await load()
    expect(event).toMatchObject({
      id: eventId,
      startsAt: '2026-11-01T18:00:00+01:00',
      organizers: [{ code: 'FEST', name: 'Festausschuss' }],
    })
    expect(Object.keys(event!).sort()).toEqual(['description', 'endsAt', 'endsAtLocal', 'id', 'location', 'organizers', 'startsAt', 'startsAtLocal', 'title'])
  })
})
