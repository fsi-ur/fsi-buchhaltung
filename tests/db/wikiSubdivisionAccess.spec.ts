import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/api/guards'
import { getEffectiveLevel, getSpaceEffectiveLevel, loadAccessIndex, resolveViewerSubjects } from '~/server/utils/wiki/access'
import setOwner, { OWNER_SUBDIVISION_NEEDS_ADMIN } from '~/server/api/wiki/articles/[id]/owner.put'
import articleAccess from '~/server/api/wiki/articles/[id]/access.get'
import deleteGrant from '~/server/api/wiki/access/[grantId].delete'
import spaceDetail from '~/server/api/wiki/spaces/[id].get'
import spaceBySlug from '~/server/api/wiki/spaces/by-slug.get'
import wikiHome from '~/server/api/wiki/home.get'
import createArticleHandler from '~/server/api/wiki/articles/create.post'
import updateSpace, { SPACE_FIELDS_NEED_MANAGE } from '~/server/api/wiki/spaces/[id].put'
import unarchive from '~/server/api/wiki/articles/[id]/unarchive.post'
import articleDetail from '~/server/api/wiki/articles/[id].get'
import { applyOwnerGrants } from '~/server/utils/wiki/grants'
import { withTransaction } from '~/server/utils/db'
import { resetDatabase } from '../helpers/db'
import {
  addSubdivisionMember,
  assignPosition,
  createMember,
  createPosition,
  createSubdivision,
  resetFixtureCounter,
} from '../helpers/fixtures'
import { signIn, type SignedInUser } from '../helpers/auth'
import { callHandler } from '../helpers/handler'
import type { PermissionKey } from '~/config/permissions'
import type { SubdivisionPermissionKey } from '~/config/subdivisionPermissions'

let slugCounter = 0

async function createSpace(ownerSubdivisionId: number | null = null) {
  slugCounter += 1
  const result = await query<any>(
    'INSERT INTO wiki_spaces (slug, title, owner_subdivision_id) VALUES (?, ?, ?)',
    [`space-${slugCounter}`, `Space ${slugCounter}`, ownerSubdivisionId],
  )
  return Number(result.insertId)
}

async function createArticle(spaceId: number, createdBy: number, options: { parentId?: number, ownerSubdivisionId?: number } = {}) {
  slugCounter += 1
  const result = await query<any>(
    `INSERT INTO wiki_articles (space_id, parent_id, slug, title, created_by, owner_subdivision_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [spaceId, options.parentId ?? null, `artikel-${slugCounter}`, `Artikel ${slugCounter}`, createdBy, options.ownerSubdivisionId ?? null],
  )
  return Number(result.insertId)
}

/** Restricts an article to one user (so the default "everyone may read" does not apply). */
async function restrictTo(articleId: number, userId: number, level: 'read' | 'write' | 'admin') {
  await query(
    `INSERT INTO wiki_access_grants
       (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
     VALUES ('article', ?, 1, 'user', ?, '', ?, ?)`,
    [articleId, userId, level, userId],
  )
}

/** A signed-in user holding a subdivision-bound position with the given scoped keys. */
async function setupLeader(
  scoped: SubdivisionPermissionKey[] = ['subdivision.wiki.manage'],
  permissions: PermissionKey[] = ['wiki.view'],
) {
  const leader = await signIn({ permissions })
  const member = await createMember({ accountId: leader.id })
  const subdivision = await createSubdivision()
  const position = await createPosition({ subdivisionBound: true, subdivisionPermissions: scoped })
  await addSubdivisionMember(subdivision, member)
  await assignPosition(member, position, { subdivisionId: subdivision })
  return { leader, subdivision }
}

/** The session's `User` (with its resolved permissions), as handlers see it. */
async function sessionUser(session: SignedInUser) {
  const auth = await requireAuth(session.event)
  if (!auth.ok) throw new Error(auth.error)
  return auth.user
}

async function levelsFor(session: SignedInUser, articleIds: number[]) {
  const [subjects, index] = await Promise.all([resolveViewerSubjects(await sessionUser(session)), loadAccessIndex()])
  return articleIds.map(id => getEffectiveLevel(index, subjects, id))
}

describe('wiki access for subdivision wiki managers', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('gives admin on articles the subdivision owns, their descendants and owned spaces', async () => {
    const { leader, subdivision } = await setupLeader()
    const other = await createSubdivision()

    const ownedSpace = await createSpace(subdivision)
    const inOwnedSpace = await createArticle(ownedSpace, leader.id)

    const space = await createSpace()
    const owned = await createArticle(space, leader.id, { ownerSubdivisionId: subdivision })
    const child = await createArticle(space, leader.id, { parentId: owned })
    const foreign = await createArticle(space, leader.id, { ownerSubdivisionId: other })
    const unowned = await createArticle(space, leader.id)

    // Restricting the owned article to someone else does not lock its subdivision out.
    const stranger = await signIn()
    await restrictTo(owned, stranger.id, 'read')

    expect(await levelsFor(leader, [inOwnedSpace, owned, child, foreign, unowned]))
      .toEqual(['admin', 'admin', 'admin', 'read', 'read'])

    const [subjects, index] = await Promise.all([resolveViewerSubjects(await sessionUser(leader)), loadAccessIndex()])
    expect(getSpaceEffectiveLevel(index, subjects, ownedSpace)).toBe('admin')
    expect(getSpaceEffectiveLevel(index, subjects, space)).toBe('read')
  })

  it('needs the scoped key — other leader keys and plain membership give nothing extra', async () => {
    const { leader, subdivision } = await setupLeader(['subdivision.members.manage'])
    const member = await signIn({ permissions: ['wiki.view'] })
    await addSubdivisionMember(subdivision, await createMember({ accountId: member.id }))

    const space = await createSpace()
    const owned = await createArticle(space, leader.id, { ownerSubdivisionId: subdivision })

    expect(await levelsFor(leader, [owned])).toEqual(['read'])
    expect(await levelsFor(member, [owned])).toEqual(['read'])
  })

  it('subdivision.wiki.edit gives write on owned content, without the admin extras', async () => {
    const { leader, subdivision } = await setupLeader(['subdivision.wiki.edit'])
    const space = await createSpace()
    const owned = await createArticle(space, leader.id, { ownerSubdivisionId: subdivision })
    const child = await createArticle(space, leader.id, { parentId: owned })
    const unowned = await createArticle(space, leader.id)

    // Restricted to someone else: the leader can still edit (and thus read) it.
    const stranger = await signIn()
    await restrictTo(owned, stranger.id, 'read')

    expect(await levelsFor(leader, [owned, child, unowned])).toEqual(['write', 'write', 'read'])

    const ownedSpace = await createSpace(subdivision)
    const [subjects, index] = await Promise.all([resolveViewerSubjects(await sessionUser(leader)), loadAccessIndex()])
    expect(getSpaceEffectiveLevel(index, subjects, ownedSpace)).toBe('write')
  })

  it('an admin grant still beats subdivision.wiki.edit', async () => {
    const { leader, subdivision } = await setupLeader(['subdivision.wiki.edit'])
    const space = await createSpace()
    const owned = await createArticle(space, leader.id, { ownerSubdivisionId: subdivision })
    await restrictTo(owned, leader.id, 'admin')
    expect(await levelsFor(leader, [owned])).toEqual(['admin'])
  })

  it('a grant created for the owner can be removed while the owner stays', async () => {
    const { leader, subdivision } = await setupLeader()
    const space = await createSpace(subdivision)
    await withTransaction(conn => applyOwnerGrants('space', space, { ownerPositionId: null, ownerSubdivisionId: subdivision }, leader.id, conn))
    const [grant] = await query<Array<{ id: number }>>(`SELECT id FROM wiki_access_grants WHERE scope_type = 'space' AND scope_id = ?`, [space])

    const { result } = await callHandler(deleteGrant, { token: leader.token, method: 'DELETE', params: { grantId: grant!.id } })
    expect(result).toEqual({ ok: true })
    const [row] = await query<Array<{ owner_subdivision_id: number }>>('SELECT owner_subdivision_id FROM wiki_spaces WHERE id = ?', [space])
    expect(Number(row!.owner_subdivision_id)).toBe(subdivision)
  })

  it('an empty space of the subdivision lets an editing leader create articles', async () => {
    const { leader, subdivision } = await setupLeader(['subdivision.wiki.edit'])
    const space = await createSpace(subdivision)
    // Only the subdivision may read the space.
    await query(
      `INSERT INTO wiki_access_grants
         (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
       VALUES ('space', ?, 1, 'subdivision', ?, '', 'read', ?)`,
      [space, subdivision, leader.id],
    )

    const home = await callHandler(wikiHome, { token: leader.token })
    expect(home.result).toMatchObject({ ok: true, canEditSomewhere: true })

    const detail = await callHandler(spaceDetail, { token: leader.token, params: { id: space } })
    expect(detail.result).toMatchObject({ ok: true, space: { id: space, accessLevel: 'write', articles: [] } })

    const created = await callHandler(createArticleHandler, {
      token: leader.token,
      body: { spaceId: space, title: 'Erster Artikel', markdown: 'Hallo' },
    })
    expect(created.result).toMatchObject({ ok: true })

    const after = await callHandler(spaceDetail, { token: leader.token, params: { id: space } })
    expect(after.result.space.articles.map((article: any) => article.title)).toEqual(['Erster Artikel'])

    // Someone outside the subdivision does not find the space at all.
    const outsider = await signIn({ permissions: ['wiki.view'] })
    const hidden = await callHandler(spaceDetail, { token: outsider.token, params: { id: space } })
    expect(hidden.result).toEqual({ ok: false, error: 'Der Bereich wurde nicht gefunden.' })
  })

  it('a managing leader edits the space presentation, but not slug, owner or archiving', async () => {
    const { leader, subdivision } = await setupLeader()
    const space = await createSpace(subdivision)
    const [row] = await query<Array<{ slug: string }>>('SELECT slug FROM wiki_spaces WHERE id = ?', [space])
    const base = { title: 'Neu', slug: row!.slug, description: 'Beschreibung', icon: '', requiresReview: true, isArchived: false, ownerPositionId: null, ownerSubdivisionId: subdivision }

    const saved = await callHandler(updateSpace, { token: leader.token, method: 'PUT', params: { id: space }, body: base })
    expect(saved.result).toEqual({ ok: true })
    const [after] = await query<Array<{ title: string, requires_review: number }>>('SELECT title, requires_review FROM wiki_spaces WHERE id = ?', [space])
    expect(after).toMatchObject({ title: 'Neu', requires_review: 1 })

    for (const change of [{ slug: 'anders' }, { isArchived: true }, { ownerSubdivisionId: null }]) {
      const refused = await callHandler(updateSpace, { token: leader.token, method: 'PUT', params: { id: space }, body: { ...base, ...change } })
      expect(refused.result).toEqual({ ok: false, error: SPACE_FIELDS_NEED_MANAGE })
    }

    // Editing leaders and plain readers may not edit the space at all.
    const editor = await setupLeader(['subdivision.wiki.edit'])
    const editorSpace = await createSpace(editor.subdivision)
    const [editorRow] = await query<Array<{ slug: string }>>('SELECT slug FROM wiki_spaces WHERE id = ?', [editorSpace])
    const denied = await callHandler(updateSpace, {
      token: editor.leader.token,
      method: 'PUT',
      params: { id: editorSpace },
      body: { ...base, slug: editorRow!.slug, ownerSubdivisionId: editor.subdivision },
    })
    expect(denied.result.ok).toBe(false)
  })

  it('lists articles in review and due for review among the editable ones', async () => {
    const { leader, subdivision } = await setupLeader(['subdivision.wiki.edit'])
    const space = await createSpace(subdivision)
    const inReview = await createArticle(space, leader.id)
    const due = await createArticle(space, leader.id)
    const fresh = await createArticle(space, leader.id)
    await query(`UPDATE wiki_articles SET status = 'in_review' WHERE id = ?`, [inReview])
    await query(
      `UPDATE wiki_articles SET status = 'published', review_interval_days = 30, published_at = ? WHERE id = ?`,
      ['2020-01-01 00:00:00', due],
    )
    await query(`UPDATE wiki_articles SET status = 'published', review_interval_days = 30, published_at = ? WHERE id = ?`, ['2037-01-01 00:00:00', fresh])

    const { result } = await callHandler(spaceDetail, { token: leader.token, params: { id: space } })
    expect(result.space.todo.inReview.map((entry: any) => entry.id)).toEqual([inReview])
    expect(result.space.todo.due.map((entry: any) => entry.id)).toEqual([due])

    // Readers get no to-do list.
    const reader = await signIn({ permissions: ['wiki.view'] })
    const readerView = await callHandler(spaceDetail, { token: reader.token, params: { id: space } })
    expect(readerView.result.space.todo).toEqual({ inReview: [], due: [] })
  })

  it('restores an archived article to its last state', async () => {
    const { leader, subdivision } = await setupLeader(['subdivision.wiki.edit'])
    const space = await createSpace(subdivision)
    const wasPublished = await createArticle(space, leader.id)
    const neverPublished = await createArticle(space, leader.id)
    await query(`UPDATE wiki_articles SET status = 'archived', content_md = 'Inhalt', published_at = '2024-01-01 00:00:00' WHERE id = ?`, [wasPublished])
    await query(`UPDATE wiki_articles SET status = 'archived' WHERE id = ?`, [neverPublished])

    const first = await callHandler(unarchive, { token: leader.token, method: 'POST', params: { id: wasPublished } })
    expect(first.result).toEqual({ ok: true, status: 'published' })
    const second = await callHandler(unarchive, { token: leader.token, method: 'POST', params: { id: neverPublished } })
    expect(second.result).toEqual({ ok: true, status: 'draft' })

    const again = await callHandler(unarchive, { token: leader.token, method: 'POST', params: { id: wasPublished } })
    expect(again.result.ok).toBe(false)

    const reader = await signIn({ permissions: ['wiki.view'] })
    await query(`UPDATE wiki_articles SET status = 'archived' WHERE id = ?`, [wasPublished])
    const denied = await callHandler(unarchive, { token: reader.token, method: 'POST', params: { id: wasPublished } })
    expect(denied.result.ok).toBe(false)
  })

  it('resolves space links only to spaces the reader can see', async () => {
    const reader = await signIn({ permissions: ['wiki.view'] })
    const { leader, subdivision } = await setupLeader()
    const open = await createSpace()
    const hidden = await createSpace(subdivision)
    await query(
      `INSERT INTO wiki_access_grants
         (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
       VALUES ('space', ?, 1, 'subdivision', ?, '', 'read', ?)`,
      [hidden, subdivision, leader.id],
    )
    const slugs = await query<Array<{ id: number, slug: string }>>('SELECT id, slug FROM wiki_spaces WHERE id IN (?, ?)', [open, hidden])
    const slugOf = (id: number) => slugs.find(row => Number(row.id) === id)!.slug

    const article = await createArticle(open, leader.id)
    await query(
      `UPDATE wiki_articles SET status = 'published', published_at = '2024-01-01 00:00:00', content_md = ? WHERE id = ?`,
      [`[[wiki:${slugOf(open)}]] [[wiki:${slugOf(hidden)}]] [[wiki:gibt-es-nicht]]`, article],
    )

    const forReader = await callHandler(articleDetail, { token: reader.token, params: { id: article } })
    expect(forReader.result.ok).toBe(true)
    expect(forReader.result.article.links).toEqual({
      [slugOf(open)]: { id: open, title: expect.any(String) },
      [slugOf(hidden)]: null,
      'gibt-es-nicht': null,
    })

    const forLeader = await callHandler(articleDetail, { token: leader.token, params: { id: article } })
    expect(forLeader.result.article.links[slugOf(hidden)]).toEqual({ id: hidden, title: expect.any(String) })
  })

  it('opens a space by its slug for shareable links, with the same visibility', async () => {
    const { leader, subdivision } = await setupLeader()
    const space = await createSpace(subdivision)
    await query(
      `INSERT INTO wiki_access_grants
         (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
       VALUES ('space', ?, 1, 'subdivision', ?, '', 'read', ?)`,
      [space, subdivision, leader.id],
    )
    const [row] = await query<Array<{ slug: string }>>('SELECT slug FROM wiki_spaces WHERE id = ?', [space])

    const found = await callHandler(spaceBySlug, { token: leader.token, path: `/api/test?slug=${row!.slug.toUpperCase()}` })
    expect(found.result).toMatchObject({ ok: true, space: { id: space, slug: row!.slug } })

    const outsider = await signIn({ permissions: ['wiki.view'] })
    const hidden = await callHandler(spaceBySlug, { token: outsider.token, path: `/api/test?slug=${row!.slug}` })
    expect(hidden.result).toEqual({ ok: false, error: 'Der Bereich wurde nicht gefunden.' })

    const bad = await callHandler(spaceBySlug, { token: leader.token, path: '/api/test?slug=../x' })
    expect(bad.result.ok).toBe(false)
  })

  it('subdivisions.leadership.edit manages the wiki of every active subdivision', async () => {
    const admin = await signIn({ permissions: ['wiki.view', 'subdivisions.leadership.edit'] })
    const active = await createSubdivision()
    const inactive = await createSubdivision({ isActive: false })

    const space = await createSpace()
    const owned = await createArticle(space, admin.id, { ownerSubdivisionId: active })
    const ownedByInactive = await createArticle(space, admin.id, { ownerSubdivisionId: inactive })

    expect(await levelsFor(admin, [owned, ownedByInactive])).toEqual(['admin', 'read'])
  })

  it('only admins may change the owner subdivision', async () => {
    const { leader, subdivision } = await setupLeader()
    const writer = await signIn({ permissions: ['wiki.view', 'wiki.edit'] })

    const space = await createSpace()
    const article = await createArticle(space, writer.id)

    // A writer making the leader's subdivision the owner would hand out admin.
    const refused = await callHandler(setOwner, {
      token: writer.token,
      method: 'PUT',
      params: { id: article },
      body: { ownerSubdivisionId: subdivision },
    })
    expect(refused.result).toEqual({ ok: false, error: OWNER_SUBDIVISION_NEEDS_ADMIN })

    // The owner position stays editable with write access.
    const positionOnly = await callHandler(setOwner, {
      token: writer.token,
      method: 'PUT',
      params: { id: article },
      body: { ownerPositionId: await createPosition() },
    })
    expect(positionOnly.result).toEqual({ ok: true })

    // An admin of an owned article may hand it to another subdivision.
    const owned = await createArticle(space, leader.id, { ownerSubdivisionId: subdivision })
    const other = await createSubdivision()
    const moved = await callHandler(setOwner, {
      token: leader.token,
      method: 'PUT',
      params: { id: owned },
      body: { ownerSubdivisionId: other },
    })
    expect(moved.result).toEqual({ ok: true })
    expect(await levelsFor(leader, [owned])).toEqual(['read'])
  })

  it('names the managing subdivisions in the access view', async () => {
    const { leader, subdivision } = await setupLeader()
    const space = await createSpace()
    const owned = await createArticle(space, leader.id, { ownerSubdivisionId: subdivision })
    const child = await createArticle(space, leader.id, { parentId: owned })

    const { result } = await callHandler(articleAccess, { token: leader.token, params: { id: child } })
    const rows = await query<Array<{ name: string }>>('SELECT name FROM subdivisions WHERE id = ?', [subdivision])
    expect(result).toMatchObject({ ok: true, canManage: true, accessLevel: 'admin', managingSubdivisions: [rows[0]!.name] })
  })
})
