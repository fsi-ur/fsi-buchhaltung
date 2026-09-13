import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import {
  countDocumentReferences,
  loadAttachmentItems,
  loadAttachmentSelection,
  loadAttachmentSelections,
  saveAttachmentSelection,
} from '~/server/utils/attachments'
import { createAssociationDocument } from '~/server/utils/associationDocuments'
import { attachFileToEntity } from '~/server/utils/files'
import { resetDatabase } from '../helpers/db'
import { createUser, resetFixtureCounter } from '../helpers/fixtures'

const ENTITY = 'wiki_article'

let userId: number

async function createFile(name = 'anhang.pdf', size = 2048) {
  const result = await query<any>(
    `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by)
     VALUES (?, ?, 'application/pdf', ?, ?)`,
    [`/uploads/attachments/${name}`, name, size, userId],
  )
  return Number(result.insertId)
}

async function createDocument(options: { title?: string, isActive?: boolean, withFile?: boolean } = {}) {
  const id = await createAssociationDocument(
    { title: options.title ?? 'Satzung', is_active: options.isActive !== false },
    userId,
  )
  if (options.withFile !== false) {
    await attachFileToEntity(await createFile(`${options.title ?? 'satzung'}.pdf`), 'association_document', id, userId)
  }
  return id
}

describe('saveAttachmentSelection', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
  })

  it('stores both kinds and reads them back in the order they were arranged', async () => {
    const [first, second] = [await createDocument({ title: 'Satzung' }), await createDocument({ title: 'Beitrag' })]
    const fileId = await createFile()

    await saveAttachmentSelection(ENTITY, 1, { documentIds: [second, first], fileIds: [fileId] }, userId)

    expect(await loadAttachmentSelection(ENTITY, 1)).toEqual({ documentIds: [second, first], fileIds: [fileId] })
  })

  it('applies a change as a diff instead of rewriting everything', async () => {
    const kept = await createDocument({ title: 'Satzung' })
    const dropped = await createDocument({ title: 'Alt' })
    await saveAttachmentSelection(ENTITY, 1, { documentIds: [kept, dropped], fileIds: [] }, userId)

    const added = await createDocument({ title: 'Neu' })
    await saveAttachmentSelection(ENTITY, 1, { documentIds: [kept, added], fileIds: [] }, userId)

    expect((await loadAttachmentSelection(ENTITY, 1)).documentIds).toEqual([kept, added])
  })

  it('detaches a removed one-off file instead of deleting the row', async () => {
    const fileId = await createFile()
    await saveAttachmentSelection(ENTITY, 1, { documentIds: [], fileIds: [fileId] }, userId)
    await saveAttachmentSelection(ENTITY, 1, { documentIds: [], fileIds: [] }, userId)

    expect((await loadAttachmentSelection(ENTITY, 1)).fileIds).toEqual([])
    const rows = await query<Array<{ detached_at: string | null, detached_by: number | null }>>(
      `SELECT detached_at, detached_by FROM file_attachments WHERE entity_type = ? AND entity_id = 1`,
      [ENTITY],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.detached_at).not.toBeNull()
    expect(Number(rows[0]?.detached_by)).toBe(userId)
  })

  it('keeps two records apart even when they carry the same document', async () => {
    const documentId = await createDocument()
    await saveAttachmentSelection(ENTITY, 1, { documentIds: [documentId], fileIds: [] }, userId)
    await saveAttachmentSelection('notification', 7, { documentIds: [documentId], fileIds: [] }, userId)

    await saveAttachmentSelection(ENTITY, 1, { documentIds: [], fileIds: [] }, userId)

    expect((await loadAttachmentSelection('notification', 7)).documentIds).toEqual([documentId])
  })
})

describe('loadAttachmentSelections', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
  })

  it('reads a whole batch and leaves out records that carry nothing', async () => {
    const documentId = await createDocument()
    const fileId = await createFile()
    await saveAttachmentSelection(ENTITY, 1, { documentIds: [documentId], fileIds: [fileId] }, userId)
    await saveAttachmentSelection(ENTITY, 2, { documentIds: [documentId], fileIds: [] }, userId)

    const selections = await loadAttachmentSelections(ENTITY, [1, 2, 3])

    expect(selections.get(1)).toEqual({ documentIds: [documentId], fileIds: [fileId] })
    expect(selections.get(2)).toEqual({ documentIds: [documentId], fileIds: [] })
    expect(selections.has(3)).toBe(false)
  })

  it('returns nothing for an empty batch without asking the database', async () => {
    expect((await loadAttachmentSelections(ENTITY, [])).size).toBe(0)
  })
})

describe('loadAttachmentItems', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
  })

  it('describes a document through the library and a file through its own row', async () => {
    const documentId = await createDocument({ title: 'Satzung' })
    const fileId = await createFile('beitritt.pdf', 512)

    const items = await loadAttachmentItems({ documentIds: [documentId], fileIds: [fileId] })

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'document', title: 'Satzung', unavailable: false })
    expect(items[1]).toMatchObject({ kind: 'file', title: 'beitritt.pdf', fileSize: 512, unavailable: false })
  })

  it('marks a document nothing could be sent for rather than dropping it', async () => {
    const inactive = await createDocument({ title: 'Alte Satzung', isActive: false })
    const fileless = await createDocument({ title: 'Noch leer', withFile: false })

    const items = await loadAttachmentItems({ documentIds: [inactive, fileless, 9999], fileIds: [] })

    expect(items.map(item => item.unavailable)).toEqual([true, true, true])
    expect(items[0]?.title).toBe('Alte Satzung')
  })
})

describe('countDocumentReferences', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
  })

  it('counts every record still pointing at the document', async () => {
    const documentId = await createDocument()
    expect(await countDocumentReferences(documentId)).toBe(0)

    await saveAttachmentSelection(ENTITY, 1, { documentIds: [documentId], fileIds: [] }, userId)
    await saveAttachmentSelection('notification', 7, { documentIds: [documentId], fileIds: [] }, userId)

    expect(await countDocumentReferences(documentId)).toBe(2)
  })
})
