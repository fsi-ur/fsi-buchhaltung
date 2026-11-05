import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import cancelNotification from '~/server/api/notifications/[id].delete'
import bankOptions from '~/server/api/bank_statements/options.get'
import { parseScopedTableSpec } from '~/server/utils/audit/log'
import { attachFileToEntity } from '~/server/utils/files'
import { resetDatabase } from '../helpers/db'
import { createReceipt, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'

async function scheduledNotification(createdBy: number | null) {
  const result = await query<any>(
    `INSERT INTO notifications (type_key, status, scheduled_for, created_at, created_by, recipient_rule)
     VALUES ('custom.message', 'scheduled', '2099-01-01 10:00:00', '2026-01-01 10:00:00', ?, '{}')`,
    [createdBy],
  )
  return Number(result.insertId)
}

// SEC-29
describe('smaller authorization gaps', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('notifications.send cancels only its own scheduled notifications', async () => {
    const sender = await signIn({ permissions: ['notifications.send'] })
    const own = await scheduledNotification(sender.id)
    const system = await scheduledNotification(null)

    expect((await callHandler(cancelNotification, { token: sender.token, method: 'DELETE', params: { id: system } })).result.ok).toBe(false)
    const [row] = await query<any[]>('SELECT status FROM notifications WHERE id = ?', [system])
    expect(row.status).toBe('scheduled')

    expect((await callHandler(cancelNotification, { token: sender.token, method: 'DELETE', params: { id: own } })).result.ok).toBe(true)

    const manager = await signIn({ permissions: ['notifications.send', 'settings.notifications.manage'] })
    expect((await callHandler(cancelNotification, { token: manager.token, method: 'DELETE', params: { id: system } })).result.ok).toBe(true)
  })

  it('bank statement options: editors see linkable records only, viewers nothing unlinked', async () => {
    const owner = await createUser()
    const draft = await createReceipt({ status: 'draft' })
    const open = await createReceipt({ status: 'open' })
    for (const id of [draft, open]) {
      const file = await query<any>(`INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by) VALUES ('/uploads/r/a.pdf', 'a.pdf', 'application/pdf', 1, ?)`, [owner.id])
      await attachFileToEntity(Number(file.insertId), 'receipt', id, owner.id)
    }

    const editor = await signIn({ permissions: ['bank_statements.edit'] })
    const editorIds = (await callHandler(bankOptions, { token: editor.token })).result.receipts.map((r: any) => r.id)
    expect(editorIds).toContain(open)
    expect(editorIds).not.toContain(draft)

    const viewer = await signIn({ permissions: ['bank_statements.view'] })
    expect((await callHandler(bankOptions, { token: viewer.token })).result.receipts).toEqual([])
  })

  it('scoped audit specs cannot filter on redacted columns', () => {
    expect(parseScopedTableSpec('users:password_hash')).toBeNull()
    expect(parseScopedTableSpec('users:id;password_hash=$2b$12$x')).toBeNull()
    expect(parseScopedTableSpec('users:id')).not.toBeNull()
  })
})
