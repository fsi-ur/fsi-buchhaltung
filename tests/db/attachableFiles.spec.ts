import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import saveWikiAttachments from '~/server/api/wiki/articles/[id]/attachments.put'
import createNotification from '~/server/api/notifications/create.post'
import { attachFileToEntity } from '~/server/utils/files'
import { FILE_NOT_ATTACHABLE } from '~/server/utils/fileAccess'
import { resetDatabase } from '../helpers/db'
import { createReceipt, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'

let ownerId: number

async function createFile(uploadedBy = ownerId) {
  const result = await query<any>(
    `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by)
     VALUES ('/uploads/test/x.pdf', 'scan.pdf', 'application/pdf', 10, ?)`,
    [uploadedBy],
  )
  return Number(result.insertId)
}

async function receiptScan() {
  const receiptId = await createReceipt()
  const fileId = await createFile()
  await attachFileToEntity(fileId, 'receipt', receiptId, ownerId)
  return fileId
}

async function createArticle() {
  const space = await query<any>('INSERT INTO wiki_spaces (slug, title) VALUES (?, ?)', ['space', 'Space'])
  const article = await query<any>(
    'INSERT INTO wiki_articles (space_id, slug, title, created_by) VALUES (?, ?, ?, ?)',
    [Number(space.insertId), 'artikel', 'Artikel', ownerId],
  )
  return Number(article.insertId)
}

async function wikiFileIds(articleId: number) {
  const rows = await query<any[]>(
    `SELECT file_id FROM file_attachments WHERE entity_type = 'wiki_article' AND entity_id = ? AND detached_at IS NULL`,
    [articleId],
  )
  return rows.map(row => Number(row.file_id))
}

// SEC-02: attaching a file makes it readable through the new record — only readable files may be attached.
describe('attaching files requires being able to read them', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    ownerId = (await createUser()).id
  })

  it('a wiki writer without receipts.view cannot attach a receipt scan', async () => {
    const writer = await signIn({ permissions: ['wiki.manage'] })
    const articleId = await createArticle()
    const fileId = await receiptScan()

    const { result } = await callHandler(saveWikiAttachments, {
      token: writer.token,
      method: 'PUT',
      params: { id: articleId },
      body: { attachments: { fileIds: [fileId] } },
    })

    expect(result).toEqual({ ok: false, error: FILE_NOT_ATTACHABLE })
    expect(await wikiFileIds(articleId)).toEqual([])
  })

  it('own uploads and already attached files still save', async () => {
    const writer = await signIn({ permissions: ['wiki.manage'] })
    const articleId = await createArticle()
    const legacy = await receiptScan()
    await attachFileToEntity(legacy, 'wiki_article', articleId, ownerId)
    const ownUpload = await createFile(writer.id)

    const { result } = await callHandler(saveWikiAttachments, {
      token: writer.token,
      method: 'PUT',
      params: { id: articleId },
      body: { attachments: { fileIds: [legacy, ownUpload] } },
    })

    expect(result.ok).toBe(true)
    expect((await wikiFileIds(articleId)).sort()).toEqual([legacy, ownUpload].sort())
  })

  it('unknown file ids are rejected without echoing anything about them', async () => {
    const writer = await signIn({ permissions: ['wiki.manage'] })
    const articleId = await createArticle()

    const { result } = await callHandler(saveWikiAttachments, {
      token: writer.token,
      method: 'PUT',
      params: { id: articleId },
      body: { attachments: { fileIds: [999_999] } },
    })
    expect(result).toEqual({ ok: false, error: FILE_NOT_ATTACHABLE })
  })

  it('notifications.send cannot attach a receipt scan to a notification', async () => {
    const sender = await signIn({ permissions: ['notifications.send'] })
    const fileId = await receiptScan()

    const { result } = await callHandler(createNotification, {
      token: sender.token,
      body: {
        subject: 'Hallo',
        body: 'Text',
        userIds: [sender.id],
        channels: ['in_app'],
        attachments: { fileIds: [fileId] },
      },
    })

    expect(result).toEqual({ ok: false, error: FILE_NOT_ATTACHABLE })
    expect(await query<any[]>(`SELECT id FROM file_attachments WHERE entity_type = 'notification'`)).toHaveLength(0)
  })
})
