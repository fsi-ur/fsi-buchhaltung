import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'

const PAGE_NAME = /^[A-Za-z][A-Za-z0-9]*$/
const SECTION_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const MAX_PAGE_NAME_LENGTH = 80
export const MAX_SECTION_KEY_LENGTH = 80

export interface PageHelpRow {
  id: number
  page_name: string
  section_key: string
  article_id: number
  position: number
  title: string
  summary: string
  status: string
  space_title: string
}

export function validatePageHelpInput(pageName: string, sectionKey: string): string | null {
  if (!pageName) return 'Bitte eine Seite auswählen.'
  if (pageName.length > MAX_PAGE_NAME_LENGTH || !PAGE_NAME.test(pageName)) {
    return `„${pageName}“ ist kein gültiger Seitenname.`
  }
  if (sectionKey) {
    if (sectionKey.length > MAX_SECTION_KEY_LENGTH || !SECTION_KEY.test(sectionKey)) {
      return 'Der Abschnitt darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.'
    }
  }
  return null
}

export function normalizeSectionKey(raw: unknown) {
  return String(raw ?? '').trim().toLowerCase().slice(0, MAX_SECTION_KEY_LENGTH)
}

export async function loadPageHelpRows(pageName: string | null, conn?: mariadb.PoolConnection) {
  return query<PageHelpRow[]>(
    `SELECT h.id, h.page_name, h.section_key, h.article_id, h.position,
            a.title, a.summary, a.status, s.title AS space_title
     FROM wiki_page_help h
     JOIN wiki_articles a ON a.id = h.article_id
     JOIN wiki_spaces s ON s.id = a.space_id
     ${pageName ? 'WHERE h.page_name = ?' : ''}
     ORDER BY h.page_name, h.section_key, h.position, a.title`,
    pageName ? [pageName] : [],
    conn,
  )
}

export async function isPageHelpMapped(
  pageName: string,
  sectionKey: string,
  articleId: number,
  conn?: mariadb.PoolConnection,
) {
  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_page_help WHERE page_name = ? AND section_key = ? AND article_id = ? LIMIT 1',
    [pageName, sectionKey, articleId],
    conn,
  )
  return rows.length > 0
}
