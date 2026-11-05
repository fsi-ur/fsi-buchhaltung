import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type {
  WikiChecklistInput,
  WikiChecklistItemInput,
  WikiChecklistItemView,
  WikiChecklistRunEntry,
  WikiChecklistRunView,
  WikiChecklistView,
} from '~/types/wiki'

const KEY_SLUG = /^[a-z0-9-]+$/
const PAGE_NAME = /^[A-Za-z][A-Za-z0-9]*$/

const MAX_CHECKLISTS = 20
const MAX_ITEMS = 100

export const MAX_RUNS_PER_CHECKLIST = 50

export interface WikiChecklistContext {
  checklistId: number
  articleId: number
  mode: 'personal' | 'shared'
}

export interface WikiChecklistRunContext extends WikiChecklistContext {
  runId: number
  createdBy: number
  closed: boolean
}

function parseMeta(raw: unknown): Record<string, any> | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function loadChecklistDefinitions(
  articleId: number,
  conn?: mariadb.PoolConnection,
): Promise<WikiChecklistInput[]> {
  const lists = await query<Array<{ id: number, key_slug: string, title: string, mode: 'personal' | 'shared' }>>(
    'SELECT id, key_slug, title, mode FROM wiki_checklists WHERE article_id = ? ORDER BY id',
    [articleId],
    conn,
  )
  if (!lists.length) return []

  const ids = lists.map(list => Number(list.id))
  const items = await query<Array<{
    id: number
    checklist_id: number
    label: string
    hint: string
    target_page: string | null
    target_meta: string | null
  }>>(
    `SELECT id, checklist_id, label, hint, target_page, target_meta
     FROM wiki_checklist_items
     WHERE checklist_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY checklist_id, position, id`,
    ids,
    conn,
  )

  return lists.map(list => ({
    id: Number(list.id),
    keySlug: list.key_slug,
    title: list.title,
    mode: list.mode,
    items: items
      .filter(item => Number(item.checklist_id) === Number(list.id))
      .map(item => ({
        id: Number(item.id),
        label: item.label,
        hint: item.hint,
        targetPage: item.target_page,
        targetMeta: parseMeta(item.target_meta),
      })),
  }))
}

export async function loadArticleChecklists(
  articleId: number,
  userId: number,
  canWrite: boolean,
  conn?: mariadb.PoolConnection,
): Promise<WikiChecklistView[]> {
  const definitions = await loadChecklistDefinitions(articleId, conn)
  if (!definitions.length) return []

  const itemIds = definitions.flatMap(list => list.items.map(item => Number(item.id)))
  const listIds = definitions.map(list => Number(list.id))

  const [personal, runs] = await Promise.all([
    itemIds.length
      ? query<Array<{ item_id: number, completed_at: string }>>(
        `SELECT item_id, completed_at
         FROM wiki_checklist_personal_state
         WHERE user_id = ? AND item_id IN (${itemIds.map(() => '?').join(', ')})`,
        [userId, ...itemIds],
        conn,
      )
      : Promise.resolve([]),
    query<Array<{
      id: number
      checklist_id: number
      title: string
      due_date: string | null
      closed_at: string | null
      created_by: number
      created_at: string
      username: string | null
      member_name: string | null
    }>>(
      `SELECT r.id, r.checklist_id, r.title, r.due_date, r.closed_at, r.created_by, r.created_at, u.username,
              TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS member_name
       FROM wiki_checklist_runs r
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN members m ON m.account = u.id
       WHERE r.checklist_id IN (${listIds.map(() => '?').join(', ')})
       ORDER BY r.closed_at IS NOT NULL, r.created_at DESC, r.id DESC`,
      listIds,
      conn,
    ),
  ])

  const runIds = runs.map(run => Number(run.id))
  const state = runIds.length
    ? await query<Array<{
      run_id: number
      item_id: number
      completed_at: string
      completed_by: number
      username: string | null
      member_name: string | null
    }>>(
      `SELECT s.run_id, s.item_id, s.completed_at, s.completed_by, u.username,
              TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS member_name
       FROM wiki_checklist_run_state s
       LEFT JOIN users u ON u.id = s.completed_by
       LEFT JOIN members m ON m.account = u.id
       WHERE s.run_id IN (${runIds.map(() => '?').join(', ')})`,
      runIds,
      conn,
    )
    : []

  const doneAt = new Map(personal.map(row => [Number(row.item_id), String(row.completed_at)]))

  return definitions.map((list) => {
    const items: WikiChecklistItemView[] = list.items.map((item, position) => ({
      id: Number(item.id),
      label: item.label,
      hint: item.hint,
      targetPage: item.targetPage,
      targetMeta: item.targetMeta,
      position,
      done: list.mode === 'personal' && doneAt.has(Number(item.id)),
      doneAt: list.mode === 'personal' ? doneAt.get(Number(item.id)) ?? null : null,
    }))

    const listRuns: WikiChecklistRunView[] = runs
      .filter(run => Number(run.checklist_id) === Number(list.id))
      .map((run) => {
        const entries: WikiChecklistRunEntry[] = state
          .filter(row => Number(row.run_id) === Number(run.id))
          .map(row => ({
            itemId: Number(row.item_id),
            completedAt: String(row.completed_at),
            completedBy: Number(row.completed_by),
            completedByName: row.member_name || row.username || '',
          }))

        return {
          id: Number(run.id),
          title: run.title,
          dueDate: run.due_date ? String(run.due_date) : null,
          closedAt: run.closed_at ? String(run.closed_at) : null,
          createdBy: Number(run.created_by),
          createdByName: run.member_name || run.username || '',
          createdAt: String(run.created_at),
          entries,
          canClose: canWrite || Number(run.created_by) === userId,
        }
      })

    return {
      id: Number(list.id),
      keySlug: list.keySlug,
      title: list.title,
      mode: list.mode,
      items,
      // Runs only exist in shared mode; personal ticks live on the items themselves.
      runs: list.mode === 'shared' ? listRuns : [],
    }
  })
}

function normalizeItem(raw: any): WikiChecklistItemInput {
  const targetPage = String(raw?.targetPage ?? '').trim()
  return {
    id: Number.isInteger(Number(raw?.id)) && Number(raw?.id) > 0 ? Number(raw.id) : null,
    label: String(raw?.label ?? '').trim().slice(0, 300),
    hint: String(raw?.hint ?? '').trim().slice(0, 500),
    targetPage: targetPage ? targetPage.slice(0, 80) : null,
    targetMeta: parseMeta(raw?.targetMeta),
  }
}

export function normalizeChecklistInput(raw: any): WikiChecklistInput {
  return {
    id: Number.isInteger(Number(raw?.id)) && Number(raw?.id) > 0 ? Number(raw.id) : null,
    keySlug: String(raw?.keySlug ?? '').trim().toLowerCase().slice(0, 80),
    title: String(raw?.title ?? '').trim().slice(0, 200),
    mode: raw?.mode === 'shared' ? 'shared' : 'personal',
    items: Array.isArray(raw?.items) ? raw.items.map(normalizeItem) : [],
  }
}

export function validateChecklists(lists: WikiChecklistInput[]): string | null {
  if (lists.length > MAX_CHECKLISTS) return `Es sind höchstens ${MAX_CHECKLISTS} Checklisten pro Artikel möglich.`

  const seen = new Set<string>()
  for (const list of lists) {
    if (!list.title) return 'Bitte für jede Checkliste einen Titel angeben.'
    if (!list.keySlug) return 'Bitte für jede Checkliste eine Kennung angeben.'
    if (!KEY_SLUG.test(list.keySlug)) {
      return `Die Kennung „${list.keySlug}“ darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.`
    }
    if (seen.has(list.keySlug)) return `Die Kennung „${list.keySlug}“ wird mehrfach verwendet.`
    seen.add(list.keySlug)

    if (!list.items.length) return `Die Checkliste „${list.title}“ braucht mindestens einen Punkt.`
    if (list.items.length > MAX_ITEMS) return `Eine Checkliste darf höchstens ${MAX_ITEMS} Punkte haben.`

    for (const item of list.items) {
      if (!item.label) return `Bitte für jeden Punkt der Checkliste „${list.title}“ einen Text angeben.`
      if (item.targetPage && !PAGE_NAME.test(item.targetPage)) {
        return `„${item.targetPage}“ ist kein gültiger Seitenname für den Öffnen-Knopf.`
      }
    }
  }

  return null
}

export async function saveArticleChecklists(
  articleId: number,
  lists: WikiChecklistInput[],
  conn: mariadb.PoolConnection,
) {
  const existing = await loadChecklistDefinitions(articleId, conn)
  const keptLists = new Set<number>()

  for (const list of lists) {
    const previous = list.id ? existing.find(entry => Number(entry.id) === Number(list.id)) : undefined

    let checklistId: number
    if (previous) {
      checklistId = Number(previous.id)
      await query(
        'UPDATE wiki_checklists SET key_slug = ?, title = ?, mode = ? WHERE id = ? AND article_id = ?',
        [list.keySlug, list.title, list.mode, checklistId, articleId],
        conn,
      )
    } else {
      const result = await query<{ insertId: number }>(
        'INSERT INTO wiki_checklists (article_id, key_slug, title, mode) VALUES (?, ?, ?, ?)',
        [articleId, list.keySlug, list.title, list.mode],
        conn,
      )
      checklistId = Number(result.insertId)
    }
    keptLists.add(checklistId)

    const keptItems: number[] = []
    for (const [position, item] of list.items.entries()) {
      const meta = item.targetMeta ? JSON.stringify(item.targetMeta) : null
      const known = previous?.items.some(entry => Number(entry.id) === Number(item.id)) ?? false

      if (item.id && known) {
        await query(
          `UPDATE wiki_checklist_items
           SET label = ?, hint = ?, target_page = ?, target_meta = ?, position = ?
           WHERE id = ? AND checklist_id = ?`,
          [item.label, item.hint, item.targetPage, meta, position, item.id, checklistId],
          conn,
        )
        keptItems.push(Number(item.id))
        continue
      }

      const result = await query<{ insertId: number }>(
        `INSERT INTO wiki_checklist_items (checklist_id, label, hint, target_page, target_meta, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [checklistId, item.label, item.hint, item.targetPage, meta, position],
        conn,
      )
      keptItems.push(Number(result.insertId))
    }

    await query(
      keptItems.length
        ? `DELETE FROM wiki_checklist_items WHERE checklist_id = ? AND id NOT IN (${keptItems.map(() => '?').join(', ')})`
        : 'DELETE FROM wiki_checklist_items WHERE checklist_id = ?',
      [checklistId, ...keptItems],
      conn,
    )
  }

  const removed = existing.filter(entry => !keptLists.has(Number(entry.id))).map(entry => Number(entry.id))
  if (removed.length) {
    await query(
      `DELETE FROM wiki_checklists WHERE article_id = ? AND id IN (${removed.map(() => '?').join(', ')})`,
      [articleId, ...removed],
      conn,
    )
  }
}

export async function loadChecklistContext(
  checklistId: number,
  conn?: mariadb.PoolConnection,
): Promise<WikiChecklistContext | null> {
  const rows = await query<Array<{ id: number, article_id: number, mode: 'personal' | 'shared' }>>(
    'SELECT id, article_id, mode FROM wiki_checklists WHERE id = ? LIMIT 1',
    [checklistId],
    conn,
  )
  const row = rows[0]
  if (!row) return null
  return { checklistId: Number(row.id), articleId: Number(row.article_id), mode: row.mode }
}

export async function loadRunContext(
  runId: number,
  conn?: mariadb.PoolConnection,
): Promise<WikiChecklistRunContext | null> {
  const rows = await query<Array<{
    id: number
    checklist_id: number
    article_id: number
    mode: 'personal' | 'shared'
    created_by: number
    closed_at: string | null
  }>>(
    `SELECT r.id, r.checklist_id, c.article_id, c.mode, r.created_by, r.closed_at
     FROM wiki_checklist_runs r
     JOIN wiki_checklists c ON c.id = r.checklist_id
     WHERE r.id = ?
     LIMIT 1`,
    [runId],
    conn,
  )
  const row = rows[0]
  if (!row) return null
  return {
    runId: Number(row.id),
    checklistId: Number(row.checklist_id),
    articleId: Number(row.article_id),
    mode: row.mode,
    createdBy: Number(row.created_by),
    closed: Boolean(row.closed_at),
  }
}

export async function itemBelongsToChecklist(
  itemId: number,
  checklistId: number,
  conn?: mariadb.PoolConnection,
) {
  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_checklist_items WHERE id = ? AND checklist_id = ? LIMIT 1',
    [itemId, checklistId],
    conn,
  )
  return rows.length > 0
}

export async function countRuns(checklistId: number, conn?: mariadb.PoolConnection) {
  const rows = await query<Array<{ total: number }>>(
    'SELECT COUNT(*) AS total FROM wiki_checklist_runs WHERE checklist_id = ?',
    [checklistId],
    conn,
  )
  return Number(rows[0]?.total ?? 0)
}
