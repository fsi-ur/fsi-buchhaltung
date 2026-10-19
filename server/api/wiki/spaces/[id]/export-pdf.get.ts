import { defineEventHandler, setHeader } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { buildVisibleTree, loadSpaceRows, loadTreeArticleRows } from '~/server/utils/wiki/articles'
import { loadChecklistDefinitions } from '~/server/utils/wiki/checklists'
import { loadArticleImageData } from '~/server/utils/wiki/images'
import { buildWikiSpacePdf, wikiPdfFileName, type WikiPdfArticle } from '~/server/utils/wiki/exportPdf'
import type { WikiTreeArticle } from '~/types/wiki'

const NOT_FOUND = 'Der Bereich wurde nicht gefunden.'

function flattenWithDepth(nodes: WikiTreeArticle[], depth = 0, into: Array<{ node: WikiTreeArticle, depth: number }> = []) {
  for (const node of nodes) {
    into.push({ node, depth })
    flattenWithDepth(node.children, depth + 1, into)
  }
  return into
}

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const spaceId = Number(event.context.params?.id)
  if (!Number.isInteger(spaceId) || spaceId <= 0) return { ok: false, error: NOT_FOUND }

  const { index, subjects } = await getWikiAccess(event, current.user)
  const [spaceRows, treeRows] = await Promise.all([loadSpaceRows(), loadTreeArticleRows()])

  const tree = buildVisibleTree(spaceRows, treeRows, index, subjects)
  const space = tree.find(entry => entry.id === spaceId)
  if (!space) return { ok: false, error: NOT_FOUND }

  const entries = flattenWithDepth(space.articles)

  const contentRows = entries.length
    ? await query<Array<{ id: number, content_md: string | null, reviewed_at: string | null, published_at: string | null }>>(
      `SELECT id, content_md, reviewed_at, published_at
       FROM wiki_articles
       WHERE id IN (${entries.map(() => '?').join(', ')})`,
      entries.map(entry => entry.node.id),
    )
    : []
  const contentById = new Map(contentRows.map(row => [Number(row.id), row]))

  const articles: WikiPdfArticle[] = []
  for (const entry of entries) {
    const content = contentById.get(entry.node.id)
    articles.push({
      id: entry.node.id,
      title: entry.node.title,
      summary: entry.node.summary,
      markdown: content?.content_md ?? '',
      checklists: await loadChecklistDefinitions(entry.node.id),
      depth: entry.depth,
      reviewedAt: content?.reviewed_at ? String(content.reviewed_at) : null,
      publishedAt: content?.published_at ? String(content.published_at) : null,
    })
  }

  const association = await getAssociationProfileForInvoice()

  let logo: { mimeType: string, data: Buffer } | null = null
  try {
    const attachedLogo = await getAssociationLogoForInvoice()
    if (attachedLogo) logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
  } catch {
    logo = null
  }

  const images = await loadArticleImageData(articles.map(article => article.id))

  const pdf = buildWikiSpacePdf({
    spaceTitle: space.title,
    spaceDescription: space.description,
    articles,
    association,
    logo,
    images,
  })

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${wikiPdfFileName(space.title)}"`)
  return pdf
})
