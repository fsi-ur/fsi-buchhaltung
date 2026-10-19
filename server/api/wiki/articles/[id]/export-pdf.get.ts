import { defineEventHandler, setHeader } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { loadChecklistDefinitions } from '~/server/utils/wiki/checklists'
import { loadArticleImageData } from '~/server/utils/wiki/images'
import { buildWikiArticlePdf, wikiPdfFileName } from '~/server/utils/wiki/exportPdf'

const NOT_FOUND = 'Der Artikel wurde nicht gefunden.'

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: NOT_FOUND }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!canReadArticle(index, subjects, articleId)) return { ok: false, error: NOT_FOUND }

  const rows = await query<Array<{
    title: string
    summary: string
    content_md: string | null
    reviewed_at: string | null
    published_at: string | null
    space_title: string
  }>>(
    `SELECT a.title, a.summary, a.content_md, a.reviewed_at, a.published_at, s.title AS space_title
     FROM wiki_articles a
     JOIN wiki_spaces s ON s.id = a.space_id
     WHERE a.id = ?
     LIMIT 1`,
    [articleId],
  )
  const row = rows[0]
  if (!row) return { ok: false, error: NOT_FOUND }

  const checklists = await loadChecklistDefinitions(articleId)
  const association = await getAssociationProfileForInvoice()

  let logo: { mimeType: string, data: Buffer } | null = null
  try {
    const attachedLogo = await getAssociationLogoForInvoice()
    if (attachedLogo) logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
  } catch {
    logo = null
  }

  const images = await loadArticleImageData([articleId])

  const pdf = buildWikiArticlePdf({
    article: {
      id: articleId,
      title: row.title,
      summary: row.summary,
      markdown: row.content_md ?? '',
      checklists,
      depth: 0,
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
      publishedAt: row.published_at ? String(row.published_at) : null,
    },
    spaceTitle: row.space_title,
    association,
    logo,
    images,
  })

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${wikiPdfFileName(row.title)}"`)
  return pdf
})
