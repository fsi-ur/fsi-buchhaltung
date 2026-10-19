import { defineEventHandler } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { storeAndAttachUploadedFile } from '~/server/utils/files'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import {
  altFromFileName,
  validateWikiImage,
  WIKI_ARTICLE_IMAGE_ENTITY_TYPE,
  WIKI_IMAGE_UPLOAD_FOLDER,
  wikiImageMarkdown,
} from '~/server/utils/wiki/images'
import type { WikiImage } from '~/types/wiki'

export type UploadWikiImageResponse =
  | { ok: true, image: WikiImage, markdown: string }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<UploadWikiImageResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const multipart = await readMultipart(event)
  const validation = validateWikiImage(multipart?.file ?? null)
  if (!validation.ok) return validation

  const upload = multipart!.file!
  const extension = validation.mimeType === 'image/png' ? '.png' : '.jpg'
  const baseName = String(upload.filename || 'bild').replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || 'bild'
  const file = { filename: `${baseName}${extension}`, type: validation.mimeType, data: upload.data }

  try {
    const { fileId } = await withAuditTransaction(current.user, conn =>
      storeAndAttachUploadedFile(file, WIKI_IMAGE_UPLOAD_FOLDER, WIKI_ARTICLE_IMAGE_ENTITY_TYPE, articleId, Number(current.user.id), conn))

    return {
      ok: true,
      image: {
        fileId,
        fileName: file.filename,
        mimeType: file.type,
        fileSize: file.data.length,
        usage: { draft: false, published: false, revisions: 0 },
      },
      markdown: wikiImageMarkdown(fileId, altFromFileName(upload.filename)),
    }
  } catch (err: any) {
    return { ok: false, error: `Das Bild konnte nicht gespeichert werden: ${err}` }
  }
})
