import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import {
  createDatabaseSnapshot,
  createEncryptedDatabaseSnapshotStream,
  parseEncryptedDatabaseSnapshot,
  previewDatabaseSnapshot,
  restoreDatabaseSnapshot,
  SnapshotError,
} from '~/server/utils/databaseSnapshots'
import { createSnapshotRestoreSession, getSnapshotRestoreSession } from '~/server/utils/snapshotRestoreSessions'
import { recordSystemEvent } from '~/server/utils/systemEvents'
import { resetDatabase } from '../helpers/db'
import { createCompany, createUser, resetFixtureCounter } from '../helpers/fixtures'

// SEC-09
describe('snapshot signing and restore log', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    await query('DELETE FROM system_events')
  })

  it('signs snapshots and detects foreign or unsigned ones', async () => {
    const snapshot = await createDatabaseSnapshot()
    expect(snapshot.tables.some(table => table.name === 'system_events')).toBe(false)
    expect(previewDatabaseSnapshot(snapshot).signature).toEqual({ present: true, valid: true })

    const foreign = { ...snapshot, signature: { algorithm: 'hmac-sha256' as const, value: '00'.repeat(32) } }
    expect(previewDatabaseSnapshot(foreign).signature).toEqual({ present: true, valid: false })

    const { signature: _drop, ...unsigned } = snapshot
    expect(previewDatabaseSnapshot(unsigned).signature.valid).toBe(false)
    await expect(restoreDatabaseSnapshot(unsigned)).rejects.toSatisfy(
      (err: unknown) => err instanceof SnapshotError && err.code === 'untrustedSnapshot',
    )
  })

  it('the streamed (downloaded) snapshot carries a valid signature', async () => {
    const chunks: Buffer[] = []
    for await (const chunk of createEncryptedDatabaseSnapshotStream('ein-langes-passwort')) chunks.push(Buffer.from(chunk))
    const snapshot = parseEncryptedDatabaseSnapshot(Buffer.concat(chunks), 'ein-langes-passwort')
    const preview = previewDatabaseSnapshot(snapshot)
    expect(preview.integrity.valid).toBe(true)
    expect(preview.signature.valid).toBe(true)
  })

  it('restores a signed snapshot and keeps the system event log', async () => {
    const actor = await createUser()
    await createCompany({ name: 'Vorher GmbH' })
    const snapshot = await createDatabaseSnapshot()

    await createCompany({ name: 'Nachher GmbH' })
    await recordSystemEvent('test.event', { id: actor.id, username: actor.username }, { note: 'before restore' })

    await restoreDatabaseSnapshot(snapshot)

    const names = (await query<any[]>('SELECT name FROM companies')).map(row => row.name)
    expect(names).toContain('Vorher GmbH')
    expect(names).not.toContain('Nachher GmbH')
    const events = await query<any[]>('SELECT event_type FROM system_events')
    expect(events.map(row => row.event_type)).toEqual(['test.event'])
  })

  it('an unsigned snapshot restores only with the explicit foreign flag', async () => {
    const { signature: _drop, ...unsigned } = await createDatabaseSnapshot()
    await expect(restoreDatabaseSnapshot(unsigned, undefined, { allowForeign: true })).resolves.toMatchObject({ ok: true })
  })

  it('binds restore tokens to the previewing user, one per user', async () => {
    const snapshot = await createDatabaseSnapshot()
    const preview = previewDatabaseSnapshot(snapshot)
    const first = createSnapshotRestoreSession(1, snapshot, preview)
    const second = createSnapshotRestoreSession(1, snapshot, preview)

    expect(() => getSnapshotRestoreSession(2, second)).toThrow(SnapshotError)
    expect(() => getSnapshotRestoreSession(1, first)).toThrow(SnapshotError)
    expect(getSnapshotRestoreSession(1, second).userId).toBe(1)
  })
})
