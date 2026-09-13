import { describe, expect, it } from 'vitest'
import {
  attachmentFilename,
  MAX_ATTACHMENTS,
  mergeAttachmentSelections,
  normalizeAttachmentSelection,
} from '~/server/utils/attachments'
import { normalizeTemplateAttachments } from '~/server/utils/notifications/settings'

describe('normalizeAttachmentSelection', () => {
  it('treats a missing selection as "nothing attached"', () => {
    expect(normalizeAttachmentSelection(undefined)).toEqual({ ok: true, value: { documentIds: [], fileIds: [] } })
    expect(normalizeAttachmentSelection(null)).toEqual({ ok: true, value: { documentIds: [], fileIds: [] } })
  })

  it('keeps both kinds side by side and deduplicates each', () => {
    expect(normalizeAttachmentSelection({ documentIds: [3, 3, 5], fileIds: [7] }))
      .toEqual({ ok: true, value: { documentIds: [3, 5], fileIds: [7] } })
  })

  it('keeps the order the user arranged', () => {
    expect(normalizeAttachmentSelection({ documentIds: [9, 2, 4] }).ok).toBe(true)
    expect((normalizeAttachmentSelection({ documentIds: [9, 2, 4] }) as any).value.documentIds).toEqual([9, 2, 4])
  })

  it.each([0, -2, 1.5, 'x'])('rejects the id %s', (id) => {
    expect(normalizeAttachmentSelection({ documentIds: [id] }).ok).toBe(false)
    expect(normalizeAttachmentSelection({ fileIds: [id] }).ok).toBe(false)
  })

  it('counts both kinds against the same ceiling', () => {
    const documentIds = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => index + 1)
    expect(normalizeAttachmentSelection({ documentIds }).ok).toBe(true)
    expect(normalizeAttachmentSelection({ documentIds, fileIds: [99] }).ok).toBe(false)
  })

  it('rejects something that is not a selection at all', () => {
    expect(normalizeAttachmentSelection('satzung.pdf').ok).toBe(false)
  })
})

describe('mergeAttachmentSelections', () => {
  it('unions a message with its template without duplicating what both carry', () => {
    const merged = mergeAttachmentSelections(
      { documentIds: [1, 2], fileIds: [10] },
      { documentIds: [2, 3], fileIds: [] },
    )
    expect(merged).toEqual({ documentIds: [1, 2, 3], fileIds: [10] })
  })

  it('ignores types that have no selection at all', () => {
    expect(mergeAttachmentSelections(undefined, null)).toEqual({ documentIds: [], fileIds: [] })
  })
})

describe('normalizeTemplateAttachments', () => {
  it('drops unknown notification types', () => {
    const result = normalizeTemplateAttachments({
      'member.welcome_active': { documentIds: [3], fileIds: [] },
      'made.up': { documentIds: [4], fileIds: [] },
    })
    expect(result).toEqual({ ok: true, value: { 'member.welcome_active': { documentIds: [3], fileIds: [] } } })
  })

  it('drops types whose selection is empty', () => {
    expect(normalizeTemplateAttachments({ 'custom.message': { documentIds: [], fileIds: [] } }))
      .toEqual({ ok: true, value: {} })
  })

  it('reports which type carries the invalid selection', () => {
    const result = normalizeTemplateAttachments({ 'custom.message': { documentIds: [0] } })
    expect(result.ok).toBe(false)
    expect((result as any).error).toContain('custom.message')
  })
})

describe('attachmentFilename', () => {
  it('names the attachment after the document, keeping the extension', () => {
    expect(attachmentFilename('Satzung', 'a4f1-uuid.pdf')).toBe('Satzung.pdf')
  })

  it('does not double the extension when the title already carries it', () => {
    expect(attachmentFilename('Satzung.pdf', 'a4f1-uuid.pdf')).toBe('Satzung.pdf')
  })

  it('strips characters no filesystem or mail client wants', () => {
    expect(attachmentFilename('Satzung: 2026/2027', 'x.pdf')).toBe('Satzung- 2026-2027.pdf')
  })

  it('falls back to the stored name when the title is blank', () => {
    expect(attachmentFilename('   ', 'beitrittserklaerung.pdf')).toBe('beitrittserklaerung.pdf')
    expect(attachmentFilename('', 'beitrittserklaerung.pdf')).toBe('beitrittserklaerung.pdf')
  })
})
