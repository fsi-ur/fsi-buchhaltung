import { loadAttachmentItems } from '~/server/utils/attachments'
import type { AttachmentSelection } from '~/types/attachment'
import type { H3Event } from 'h3'
import { query } from '~/server/utils/db'
import type { User } from '~/types/user'
import { canReadArticle, getEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { renderArticle } from '~/server/utils/wiki/render'
import {
  buildBreadcrumbs,
  buildVisibleTree,
  extractHeadings,
  flattenTree,
  isStale,
  loadAttachments,
  loadAttachmentSelectionForArticle,
  loadOwner,
  loadSpaceRows,
  loadTags,
  loadTreeArticleRows,
  trackArticleView,
} from '~/server/utils/wiki/articles'
import { loadArticleChecklists } from '~/server/utils/wiki/checklists'
import type { WikiAccessLevel, WikiArticle, WikiArticleLink, WikiChecklistView, WikiSpace } from '~/types/wiki'
import type { WikiHeading } from '~/server/utils/wiki/render'

export type WikiLinkResolution = Record<string, { id: number, title: string } | null>

export interface WikiArticleDetailPayload {
  id: number
  spaceId: number
  spaceSlug: string
  spaceTitle: string
  parentId: number | null
  slug: string
  path: string
  title: string
  summary: string
  icon: string | null
  status: WikiArticle['status']
  contentHtml: string
  contentMd: string | null
  draftMd: string | null
  headings: WikiHeading[]
  breadcrumbs: ReturnType<typeof buildBreadcrumbs>
  children: WikiArticleLink[]
  prev: WikiArticleLink | null
  next: WikiArticleLink | null
  tags: Awaited<ReturnType<typeof loadTags>>
  attachments: Awaited<ReturnType<typeof loadAttachments>>
  attachmentSelection: AttachmentSelection
  owner: Awaited<ReturnType<typeof loadOwner>>
  links: WikiLinkResolution
  checklists: WikiChecklistView[]
  accessLevel: WikiAccessLevel
  hasDraft: boolean
  isStale: boolean
  requiresReview: boolean
  publishedAt: string | null
  updatedAt: string | null
  reviewedAt: string | null
}

export type WikiArticleDetailResult =
  | { ok: true, article: WikiArticleDetailPayload }
  | { ok: false, error: string }

const LINK_ATTRIBUTE = /data-wiki-article="([^"]+)"/g

function toLink(node: { id: number, slug: string, title: string }, spaceSlug: string): WikiArticleLink {
  return { id: node.id, slug: node.slug, spaceSlug, title: node.title }
}

export async function loadArticleDetail(
  event: H3Event,
  user: User,
  articleId: number,
  options: { track?: boolean } = {},
): Promise<WikiArticleDetailResult> {
  const { index, subjects } = await getWikiAccess(event, user)

  if (!index.articles.has(articleId)) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
  if (!canReadArticle(index, subjects, articleId)) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const level = getEffectiveLevel(index, subjects, articleId) as WikiAccessLevel

  const rows = await query<WikiArticle[]>(
    `SELECT id, space_id, parent_id, slug, title, summary, icon, position, status,
            content_md, content_html, draft_md, draft_updated_at, review_interval_days,
            reviewed_at, published_at, owner_position_id, owner_subdivision_id, updated_at
     FROM wiki_articles
     WHERE id = ?
     LIMIT 1`,
    [articleId],
  )
  const article = rows[0]
  if (!article) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const [spaces, treeRows] = await Promise.all([loadSpaceRows(), loadTreeArticleRows()])
  const space = spaces.find(entry => Number(entry.id) === Number(article.space_id)) as WikiSpace | undefined
  if (!space) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const byId = new Map(treeRows.map(row => [Number(row.id), row]))

  // The reader navigates published content; an editor additionally sees their own drafts in the tree,
  // and prev/next has to follow the very same visibility rules.
  const includeDrafts = levelAtLeast(level, 'write')
  const tree = buildVisibleTree(spaces, treeRows, index, subjects, { includeDrafts })
  const spaceTree = tree.find(entry => entry.id === Number(article.space_id))
  const flat = spaceTree ? flattenTree(spaceTree.articles) : []
  const position = flat.findIndex(node => node.id === articleId)

  const children = (flat.find(node => node.id === articleId)?.children ?? [])
    .map(child => toLink(child, space.slug))

  const prevNode = position > 0 ? flat[position - 1] : undefined
  const nextNode = position >= 0 && position < flat.length - 1 ? flat[position + 1] : undefined
  const prev = prevNode ? toLink(prevNode, space.slug) : null
  const next = nextNode ? toLink(nextNode, space.slug) : null

  const [tags, attachmentSelection, owner, checklists] = await Promise.all([
    loadTags(articleId),
    loadAttachmentSelectionForArticle(articleId),
    loadOwner(
      article.owner_position_id === null ? null : Number(article.owner_position_id),
      article.owner_subdivision_id === null ? null : Number(article.owner_subdivision_id),
    ),
    loadArticleChecklists(articleId, subjects.userId, includeDrafts),
  ])

  const attachments = await loadAttachmentItems(attachmentSelection)

  // Readers only ever see the published render; the draft lives in `draftMd` for the editor
  const contentHtml = await ensureRenderedHtml(article)

  const links: WikiLinkResolution = {}
  LINK_ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_ATTRIBUTE.exec(contentHtml)) !== null) {
    const path = match[1] ?? ''
    if (path in links) continue
    const [spaceSlug, slug] = path.split('/')
    const targetSpace = spaces.find(entry => entry.slug === spaceSlug)
    const target = targetSpace
      ? treeRows.find(row => Number(row.space_id) === Number(targetSpace.id) && row.slug === slug)
      : undefined
    links[path] = target && canReadArticle(index, subjects, Number(target.id))
      ? { id: Number(target.id), title: target.title }
      : null
  }

  if (options.track !== false) void trackArticleView(subjects.userId, articleId)

  return {
    ok: true,
    article: {
      id: articleId,
      spaceId: Number(article.space_id),
      spaceSlug: space.slug,
      spaceTitle: space.title,
      parentId: article.parent_id === null ? null : Number(article.parent_id),
      slug: article.slug,
      path: `${space.slug}/${article.slug}`,
      title: article.title,
      summary: article.summary,
      icon: article.icon,
      status: article.status,
      contentHtml,
      contentMd: levelAtLeast(level, 'write') ? article.content_md : null,
      draftMd: levelAtLeast(level, 'write') ? article.draft_md : null,
      headings: extractHeadings(contentHtml),
      breadcrumbs: buildBreadcrumbs(
        { id: articleId, space_id: Number(article.space_id), parent_id: article.parent_id, slug: article.slug, title: article.title },
        space,
        byId,
        index,
        subjects,
      ),
      children,
      prev,
      next,
      tags,
      attachments,
      attachmentSelection,
      owner,
      links,
      checklists,
      accessLevel: level,
      hasDraft: Boolean(article.draft_md),
      isStale: isStale(article),
      requiresReview: Boolean(space.requires_review),
      publishedAt: article.published_at ? String(article.published_at) : null,
      updatedAt: article.updated_at ? String(article.updated_at) : null,
      reviewedAt: article.reviewed_at ? String(article.reviewed_at) : null,
    },
  }
}

async function ensureRenderedHtml(article: WikiArticle): Promise<string> {
  if (article.content_html) return article.content_html
  if (!article.content_md) return ''

  const rendered = renderArticle(article.content_md)
  if (!rendered.ok) return ''

  try {
    await query(
      'UPDATE wiki_articles SET content_html = ?, content_text = ? WHERE id = ?',
      [rendered.html, rendered.text, article.id],
    )
  } catch {
    // A failed cache write must not break the read
  }

  return rendered.html
}

export async function resolveArticleIdBySlug(spaceSlug: string, slug: string): Promise<number | null> {
  const rows = await query<Array<{ id: number }>>(
    `SELECT a.id
     FROM wiki_articles a
     JOIN wiki_spaces s ON s.id = a.space_id
     WHERE s.slug = ? AND a.slug = ?
     LIMIT 1`,
    [spaceSlug, slug],
  )
  if (rows[0]) return Number(rows[0].id)

  const spaceRows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_spaces WHERE slug = ? LIMIT 1',
    [spaceSlug],
  )
  if (spaceRows.length) return null

  const fallback = await query<Array<{ id: number }>>(
    `SELECT id FROM wiki_articles WHERE slug = ? ORDER BY status = 'published' DESC, id LIMIT 1`,
    [slug],
  )
  return fallback[0] ? Number(fallback[0].id) : null
}
