import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { SLUG_PATTERN } from '~/server/utils/wiki/articles'

/** Fallback used when the author leaves the icon field empty — the same one `db/init.sql` defaults to. */
export const DEFAULT_SPACE_ICON = 'material-symbols:menu-book-rounded'

export interface SpaceValidationInput {
  title?: string
  slug?: string
  description?: string
  icon?: string
}

export function validateSpaceFields(input: SpaceValidationInput): string | null {
  const title = input.title?.trim() ?? ''
  if (!title) return 'Bitte einen Titel angeben.'
  if (title.length > 150) return 'Der Titel darf höchstens 150 Zeichen lang sein.'

  const slug = input.slug?.trim() ?? ''
  if (!slug) return 'Bitte einen Kurznamen (Slug) angeben.'
  if (slug.length > 100) return 'Der Kurzname darf höchstens 100 Zeichen lang sein.'
  if (!SLUG_PATTERN.test(slug)) {
    return 'Der Kurzname darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.'
  }

  if ((input.description ?? '').length > 500) return 'Die Beschreibung darf höchstens 500 Zeichen lang sein.'

  const icon = input.icon?.trim() ?? ''
  if (icon.length > 100) return 'Der Icon-Name darf höchstens 100 Zeichen lang sein.'
  // Icons are rendered by `@nuxt/icon` from a collection name — anything else silently renders nothing.
  if (icon && !/^[a-z0-9-]+:[a-z0-9-]+$/.test(icon)) {
    return 'Der Icon-Name muss die Form "sammlung:name" haben, zum Beispiel "material-symbols:menu-book-rounded".'
  }

  return null
}

export async function isSpaceSlugTaken(slug: string, exceptSpaceId: number | null, conn?: mariadb.PoolConnection) {
  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_spaces WHERE slug = ? AND id <> ? LIMIT 1',
    [slug, exceptSpaceId ?? 0],
    conn,
  )
  return rows.length > 0
}
