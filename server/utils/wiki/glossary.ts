import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { slugifyTitle } from '~/server/utils/wiki/articles'
import { canReadArticle, type ViewerSubjects, type WikiAccessIndex } from '~/server/utils/wiki/access'

export const MAX_TERM_LENGTH = 120
export const MAX_DEFINITION_LENGTH = 500

export function glossaryKey(value: string) {
  return slugifyTitle(String(value ?? '').trim())
}

export interface GlossaryTermRow {
  id: number
  term: string
  short_definition: string
  article_id: number | null
  article_title: string | null
  article_status: string | null
}

export interface GlossaryTermView {
  id: number
  key: string
  term: string
  shortDefinition: string
  aliases: string[]
  /** Only set when the reader may actually open the linked article. */
  articleId: number | null
  articleTitle: string | null
}

export interface GlossaryInput {
  term: string
  shortDefinition: string
  aliases: string[]
  articleId: number | null
}

export function parseGlossaryInput(body: any): { ok: true, input: GlossaryInput } | { ok: false, error: string } {
  const term = String(body?.term ?? '').trim()
  const shortDefinition = String(body?.shortDefinition ?? '').trim()
  const rawAliases = Array.isArray(body?.aliases) ? body.aliases : []
  const articleIdRaw = body?.articleId

  if (!term) return { ok: false, error: 'Bitte einen Begriff angeben.' }
  if (term.length > MAX_TERM_LENGTH) return { ok: false, error: `Der Begriff darf höchstens ${MAX_TERM_LENGTH} Zeichen lang sein.` }
  if (!glossaryKey(term)) return { ok: false, error: 'Der Begriff muss mindestens einen Buchstaben oder eine Ziffer enthalten.' }

  if (!shortDefinition) return { ok: false, error: 'Bitte eine kurze Erklärung angeben.' }
  if (shortDefinition.length > MAX_DEFINITION_LENGTH) {
    return { ok: false, error: `Die Erklärung darf höchstens ${MAX_DEFINITION_LENGTH} Zeichen lang sein.` }
  }

  const aliases: string[] = []
  for (const entry of rawAliases) {
    const alias = String(entry ?? '').trim()
    if (!alias) continue
    if (alias.length > MAX_TERM_LENGTH) return { ok: false, error: `Ein Synonym darf höchstens ${MAX_TERM_LENGTH} Zeichen lang sein.` }
    if (!glossaryKey(alias)) return { ok: false, error: 'Ein Synonym muss mindestens einen Buchstaben oder eine Ziffer enthalten.' }
    if (glossaryKey(alias) === glossaryKey(term)) continue
    if (aliases.some(existing => glossaryKey(existing) === glossaryKey(alias))) continue
    aliases.push(alias)
  }

  const articleId = articleIdRaw === null || articleIdRaw === undefined || articleIdRaw === ''
    ? null
    : Number(articleIdRaw)
  if (articleId !== null && (!Number.isInteger(articleId) || articleId <= 0)) {
    return { ok: false, error: 'Der verknüpfte Artikel wurde nicht gefunden.' }
  }

  return { ok: true, input: { term, shortDefinition, aliases, articleId } }
}

export async function loadGlossaryRows(conn?: mariadb.PoolConnection) {
  const terms = await query<GlossaryTermRow[]>(
    `SELECT g.id, g.term, g.short_definition, g.article_id,
            a.title AS article_title, a.status AS article_status
     FROM wiki_glossary_terms g
     LEFT JOIN wiki_articles a ON a.id = g.article_id
     ORDER BY g.term`,
    [],
    conn,
  )

  const aliasRows = terms.length
    ? await query<Array<{ term_id: number, alias: string }>>(
      'SELECT term_id, alias FROM wiki_glossary_aliases ORDER BY alias',
      [],
      conn,
    )
    : []

  const aliasesByTerm = new Map<number, string[]>()
  for (const row of aliasRows) {
    const termId = Number(row.term_id)
    const list = aliasesByTerm.get(termId)
    if (list) list.push(row.alias)
    else aliasesByTerm.set(termId, [row.alias])
  }

  return { terms, aliasesByTerm }
}

export function toGlossaryViews(
  terms: GlossaryTermRow[],
  aliasesByTerm: Map<number, string[]>,
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
): GlossaryTermView[] {
  return terms.map((row) => {
    const articleId = row.article_id === null ? null : Number(row.article_id)
    const readable = articleId !== null && canReadArticle(index, subjects, articleId)

    return {
      id: Number(row.id),
      key: glossaryKey(row.term),
      term: row.term,
      shortDefinition: row.short_definition,
      aliases: aliasesByTerm.get(Number(row.id)) ?? [],
      articleId: readable ? articleId : null,
      articleTitle: readable ? row.article_title : null,
    }
  })
}

export async function isGlossaryKeyTaken(
  keys: string[],
  exceptTermId: number | null,
  conn?: mariadb.PoolConnection,
): Promise<string | null> {
  const { terms, aliasesByTerm } = await loadGlossaryRows(conn)
  const taken = new Map<string, string>()

  for (const row of terms) {
    if (exceptTermId !== null && Number(row.id) === exceptTermId) continue
    taken.set(glossaryKey(row.term), row.term)
    for (const alias of aliasesByTerm.get(Number(row.id)) ?? []) taken.set(glossaryKey(alias), alias)
  }

  for (const key of keys) {
    const conflict = taken.get(key)
    if (conflict) return conflict
  }
  return null
}

export async function replaceAliases(
  termId: number,
  aliases: string[],
  conn: mariadb.PoolConnection,
) {
  await query('DELETE FROM wiki_glossary_aliases WHERE term_id = ?', [termId], conn)
  for (const alias of aliases) {
    await query('INSERT INTO wiki_glossary_aliases (term_id, alias) VALUES (?, ?)', [termId, alias], conn)
  }
}
