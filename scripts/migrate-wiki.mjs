import mariadb from 'mariadb'
import {
  SPACES,
  ARTICLES,
  SUBDIVISION_ARTICLE,
  CHECKLISTS,
  GLOSSARY,
  PATHS,
  PAGE_HELP,
} from './wiki-seed-content.mjs'

const {
  DB_HOST = 'buchhaltung-db-local',
  DB_PORT = '3307',
  DB_USER = 'fsi',
  DB_PASSWORD = 'fsi_password',
  DB_NAME = 'fsi_buchhaltung',
  DB_AUDIT_SETUP_USER,
  DB_AUDIT_SETUP_PASSWORD,
  DB_CONN_LIMIT = '2',
} = process.env

const WIKI_PERMISSION_KEYS = ['wiki.view', 'wiki.edit', 'wiki.review', 'wiki.manage']

// Kept in sync with db/init.sql. `wiki_articles` is created without its FULLTEXT index here so a
// storage engine that refuses the index cannot take the whole table down with it — see
// ensureFulltextIndex().
const TABLES = [
  ['wiki_spaces', `
    CREATE TABLE IF NOT EXISTS wiki_spaces (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(150) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      icon VARCHAR(100) NOT NULL DEFAULT 'material-symbols:menu-book-rounded',
      position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      requires_review TINYINT(1) NOT NULL DEFAULT 0,
      is_archived TINYINT(1) NOT NULL DEFAULT 0,
      owner_position_id BIGINT UNSIGNED NULL,
      owner_subdivision_id MEDIUMINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_position_id) REFERENCES positions(id) ON DELETE SET NULL,
      FOREIGN KEY (owner_subdivision_id) REFERENCES subdivisions(id) ON DELETE SET NULL
    )
  `],
  ['wiki_articles', `
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      space_id BIGINT UNSIGNED NOT NULL,
      parent_id BIGINT UNSIGNED NULL,
      slug VARCHAR(120) NOT NULL,
      title VARCHAR(200) NOT NULL,
      summary VARCHAR(500) NOT NULL DEFAULT '',
      icon VARCHAR(100) NULL,
      position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('draft','in_review','published','archived') NOT NULL DEFAULT 'draft',
      content_md MEDIUMTEXT NULL,
      content_html MEDIUMTEXT NULL,
      content_text MEDIUMTEXT NULL,
      draft_md MEDIUMTEXT NULL,
      draft_updated_at TIMESTAMP NULL,
      draft_updated_by BIGINT UNSIGNED NULL,
      review_interval_days SMALLINT UNSIGNED NULL,
      reviewed_at TIMESTAMP NULL,
      reviewed_by BIGINT UNSIGNED NULL,
      published_at TIMESTAMP NULL,
      owner_position_id BIGINT UNSIGNED NULL,
      owner_subdivision_id MEDIUMINT UNSIGNED NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wiki_article_slug (space_id, slug),
      KEY idx_wiki_article_parent (parent_id),
      FOREIGN KEY (space_id) REFERENCES wiki_spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (draft_updated_by) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id),
      FOREIGN KEY (owner_position_id) REFERENCES positions(id) ON DELETE SET NULL,
      FOREIGN KEY (owner_subdivision_id) REFERENCES subdivisions(id) ON DELETE SET NULL
    )
  `],
  ['wiki_access_grants', `
    CREATE TABLE IF NOT EXISTS wiki_access_grants (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      scope_type ENUM('space','article') NOT NULL,
      scope_id BIGINT UNSIGNED NOT NULL,
      include_descendants TINYINT(1) NOT NULL DEFAULT 1,
      subject_type ENUM('user','role','position','subdivision','permission') NOT NULL,
      subject_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      subject_key VARCHAR(100) NOT NULL DEFAULT '',
      access_level ENUM('read','write','admin') NOT NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wiki_grant (scope_type, scope_id, subject_type, subject_id, subject_key, access_level),
      KEY idx_wiki_grant_scope (scope_type, scope_id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `],
  ['wiki_tags', `
    CREATE TABLE IF NOT EXISTS wiki_tags (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(60) NOT NULL UNIQUE,
      label VARCHAR(80) NOT NULL
    )
  `],
  ['wiki_article_tags', `
    CREATE TABLE IF NOT EXISTS wiki_article_tags (
      article_id BIGINT UNSIGNED NOT NULL,
      tag_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (article_id, tag_id),
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES wiki_tags(id) ON DELETE CASCADE
    )
  `],
  ['wiki_article_revisions', `
    CREATE TABLE IF NOT EXISTS wiki_article_revisions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      article_id BIGINT UNSIGNED NOT NULL,
      revision_number INT UNSIGNED NOT NULL,
      title VARCHAR(200) NOT NULL,
      summary VARCHAR(500) NOT NULL DEFAULT '',
      content_md MEDIUMTEXT NOT NULL,
      change_note VARCHAR(300) NOT NULL DEFAULT '',
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wiki_revision (article_id, revision_number),
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `],
  ['wiki_paths', `
    CREATE TABLE IF NOT EXISTS wiki_paths (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(200) NOT NULL,
      description VARCHAR(1000) NOT NULL DEFAULT '',
      icon VARCHAR(100) NOT NULL DEFAULT 'material-symbols:hiking-rounded',
      position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `],
  ['wiki_path_items', `
    CREATE TABLE IF NOT EXISTS wiki_path_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      path_id BIGINT UNSIGNED NOT NULL,
      article_id BIGINT UNSIGNED NOT NULL,
      position SMALLINT UNSIGNED NOT NULL,
      note VARCHAR(300) NOT NULL DEFAULT '',
      FOREIGN KEY (path_id) REFERENCES wiki_paths(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
    )
  `],
  ['wiki_path_audiences', `
    CREATE TABLE IF NOT EXISTS wiki_path_audiences (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      path_id BIGINT UNSIGNED NOT NULL,
      position_id BIGINT UNSIGNED NULL,
      subdivision_id MEDIUMINT UNSIGNED NULL,
      FOREIGN KEY (path_id) REFERENCES wiki_paths(id) ON DELETE CASCADE,
      FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
      FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id) ON DELETE CASCADE
    )
  `],
  ['wiki_path_progress', `
    CREATE TABLE IF NOT EXISTS wiki_path_progress (
      user_id BIGINT UNSIGNED NOT NULL,
      path_item_id BIGINT UNSIGNED NOT NULL,
      completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, path_item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (path_item_id) REFERENCES wiki_path_items(id) ON DELETE CASCADE
    )
  `],
  ['wiki_checklists', `
    CREATE TABLE IF NOT EXISTS wiki_checklists (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      article_id BIGINT UNSIGNED NOT NULL,
      key_slug VARCHAR(80) NOT NULL,
      title VARCHAR(200) NOT NULL,
      mode ENUM('personal','shared') NOT NULL DEFAULT 'personal',
      UNIQUE KEY uq_wiki_checklist (article_id, key_slug),
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
    )
  `],
  ['wiki_checklist_items', `
    CREATE TABLE IF NOT EXISTS wiki_checklist_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      checklist_id BIGINT UNSIGNED NOT NULL,
      label VARCHAR(300) NOT NULL,
      hint VARCHAR(500) NOT NULL DEFAULT '',
      target_page VARCHAR(80) NULL,
      target_meta TEXT NULL,
      position SMALLINT UNSIGNED NOT NULL,
      FOREIGN KEY (checklist_id) REFERENCES wiki_checklists(id) ON DELETE CASCADE
    )
  `],
  ['wiki_checklist_personal_state', `
    CREATE TABLE IF NOT EXISTS wiki_checklist_personal_state (
      user_id BIGINT UNSIGNED NOT NULL,
      item_id BIGINT UNSIGNED NOT NULL,
      completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES wiki_checklist_items(id) ON DELETE CASCADE
    )
  `],
  ['wiki_checklist_runs', `
    CREATE TABLE IF NOT EXISTS wiki_checklist_runs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      checklist_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(200) NOT NULL,
      due_date DATE NULL,
      closed_at TIMESTAMP NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (checklist_id) REFERENCES wiki_checklists(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `],
  ['wiki_checklist_run_state', `
    CREATE TABLE IF NOT EXISTS wiki_checklist_run_state (
      run_id BIGINT UNSIGNED NOT NULL,
      item_id BIGINT UNSIGNED NOT NULL,
      completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_by BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (run_id, item_id),
      FOREIGN KEY (run_id) REFERENCES wiki_checklist_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES wiki_checklist_items(id) ON DELETE CASCADE,
      FOREIGN KEY (completed_by) REFERENCES users(id)
    )
  `],
  ['wiki_glossary_terms', `
    CREATE TABLE IF NOT EXISTS wiki_glossary_terms (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      term VARCHAR(120) NOT NULL UNIQUE,
      short_definition VARCHAR(500) NOT NULL,
      article_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE SET NULL
    )
  `],
  ['wiki_glossary_aliases', `
    CREATE TABLE IF NOT EXISTS wiki_glossary_aliases (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      term_id BIGINT UNSIGNED NOT NULL,
      alias VARCHAR(120) NOT NULL UNIQUE,
      FOREIGN KEY (term_id) REFERENCES wiki_glossary_terms(id) ON DELETE CASCADE
    )
  `],
  ['wiki_page_help', `
    CREATE TABLE IF NOT EXISTS wiki_page_help (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      page_name VARCHAR(80) NOT NULL,
      section_key VARCHAR(80) NOT NULL DEFAULT '',
      article_id BIGINT UNSIGNED NOT NULL,
      position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      UNIQUE KEY uq_wiki_page_help (page_name, section_key, article_id),
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
    )
  `],
  ['wiki_article_views', `
    CREATE TABLE IF NOT EXISTS wiki_article_views (
      user_id BIGINT UNSIGNED NOT NULL,
      article_id BIGINT UNSIGNED NOT NULL,
      last_viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      view_count INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, article_id),
      KEY idx_wiki_view_recent (user_id, last_viewed_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
    )
  `],
]

async function tableExists(conn, databaseName, tableName) {
  const rows = await conn.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     LIMIT 1`,
    [databaseName, tableName],
  )
  return rows.length > 0
}

async function indexExists(conn, databaseName, tableName, indexName) {
  const rows = await conn.query(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [databaseName, tableName, indexName],
  )
  return rows.length > 0
}

/**
 * FULLTEXT on InnoDB works from MariaDB 10.0 onwards, but the search util must survive an install
 * where it could not be created — so a failure here is a warning, not an abort. `wiki/search.ts`
 * probes for the index and falls back to LIKE.
 */
async function ensureFulltextIndex(conn, databaseName) {
  if (await indexExists(conn, databaseName, 'wiki_articles', 'ft_wiki_article')) return

  try {
    await conn.query('ALTER TABLE wiki_articles ADD FULLTEXT KEY ft_wiki_article (title, summary, content_text)')
    console.log('migrate-wiki: created FULLTEXT index ft_wiki_article')
  } catch (error) {
    console.warn(
      'migrate-wiki: could not create FULLTEXT index ft_wiki_article, wiki search will fall back to LIKE:',
      error?.message ?? error,
    )
  }
}

async function roleIdByCode(conn, code) {
  const rows = await conn.query('SELECT id FROM roles WHERE code = ? LIMIT 1', [code])
  return rows.length ? Number(rows[0].id) : null
}

async function defaultRoleId(conn) {
  const rows = await conn.query('SELECT id FROM roles WHERE is_default = 1 ORDER BY id LIMIT 1')
  if (rows.length) return Number(rows[0].id)
  return await roleIdByCode(conn, 'user')
}

/**
 * `ensureRole()` in seed-admin.mjs only seeds role_permissions when it *creates* a role, so an
 * already-seeded install would never pick the wiki keys up. Grant them here instead: `wiki.view` for
 * everyone through the default role, all four for the admin role.
 */
async function grantPermissions(conn) {
  const defaultRole = await defaultRoleId(conn)
  if (defaultRole) {
    await conn.query(
      'INSERT IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)',
      [defaultRole, 'wiki.view'],
    )
    console.log('migrate-wiki: granted wiki.view to the default role')
  } else {
    console.warn('migrate-wiki: no default role found, skipped granting wiki.view')
  }

  const adminRole = await roleIdByCode(conn, 'admin')
  if (adminRole) {
    for (const key of WIKI_PERMISSION_KEYS) {
      await conn.query(
        'INSERT IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)',
        [adminRole, key],
      )
    }
    console.log('migrate-wiki: granted all wiki permissions to the admin role')
  }
}

async function seedSpaces(conn) {
  for (const [slug, title, description, icon, position] of SPACES) {
    await conn.query(
      `INSERT IGNORE INTO wiki_spaces (slug, title, description, icon, position)
       VALUES (?, ?, ?, ?, ?)`,
      [slug, title, description, icon, position],
    )
  }
  console.log('migrate-wiki: seeded wiki spaces')
}

const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/** Mirrors slugifyTitle() in server/utils/wiki/articles.ts — slugs must match what the app produces. */
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[äöüß]/g, char => UMLAUTS[char] ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function findPosition(positions, wantedWords) {
  return positions.find((row) => {
    const words = new Set([...slugify(row.code).split('-'), ...slugify(row.name).split('-')])
    return wantedWords.some(word => words.has(word))
  }) ?? null
}

async function insertArticle(conn, spaceId, article, authorId, parentId) {
  await conn.query(
    `INSERT IGNORE INTO wiki_articles
       (space_id, parent_id, slug, title, summary, position, status, content_md, content_text,
        review_interval_days, published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      spaceId,
      parentId ?? null,
      article.slug,
      article.title,
      article.summary,
      article.position,
      article.markdown,
      article.markdown,
      article.reviewIntervalDays ?? null,
      authorId,
    ],
  )

  const rows = await conn.query(
    'SELECT id FROM wiki_articles WHERE space_id = ? AND slug = ? LIMIT 1',
    [spaceId, article.slug],
  )
  return rows.length ? Number(rows[0].id) : null
}

async function insertGrant(conn, scopeType, scopeId, subjectType, subjectId, subjectKey, level, authorId) {
  await conn.query(
    `INSERT IGNORE INTO wiki_access_grants
       (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    [scopeType, scopeId, subjectType, subjectId, subjectKey, level, authorId],
  )
}

async function seedArticles(conn, authorId) {
  const spaceRows = await conn.query('SELECT id, slug FROM wiki_spaces')
  const spaceIdBySlug = new Map(spaceRows.map(row => [row.slug, Number(row.id)]))
  const articleIds = new Map()

  for (const article of ARTICLES) {
    const spaceId = spaceIdBySlug.get(article.space)
    if (!spaceId) continue

    const parentId = article.parentSlug
      ? articleIds.get(`${article.space}/${article.parentSlug}`) ?? null
      : null

    const articleId = await insertArticle(conn, spaceId, article, authorId, parentId)
    if (!articleId) continue
    articleIds.set(`${article.space}/${article.slug}`, articleId)

    if (article.restrictTo) {
      await insertGrant(conn, 'article', articleId, 'permission', 0, article.restrictTo, 'read', authorId)
    }
  }

  console.log(`migrate-wiki: seeded ${articleIds.size} articles`)
  return { articleIds, spaceIdBySlug }
}

async function seedSubdivisionArticles(conn, authorId, articleIds, spaceIdBySlug) {
  const spaceId = spaceIdBySlug.get(SUBDIVISION_ARTICLE.space)
  const parentId = articleIds.get(`${SUBDIVISION_ARTICLE.space}/${SUBDIVISION_ARTICLE.parentSlug}`)
  if (!spaceId || !parentId) return

  const subdivisions = await conn.query('SELECT id, name FROM subdivisions ORDER BY name')
  let position = 10

  for (const row of subdivisions) {
    const slug = slugify(row.name)
    if (!slug) continue

    const articleId = await insertArticle(
      conn,
      spaceId,
      {
        slug,
        title: row.name,
        summary: SUBDIVISION_ARTICLE.summary,
        position,
        markdown: SUBDIVISION_ARTICLE.markdown(row.name),
      },
      authorId,
      parentId,
    )
    position += 10
    if (!articleId) continue

    await conn.query(
      'UPDATE wiki_articles SET owner_subdivision_id = ? WHERE id = ? AND owner_subdivision_id IS NULL',
      [Number(row.id), articleId],
    )
    await insertGrant(conn, 'article', articleId, 'subdivision', Number(row.id), '', 'write', authorId)
  }

  if (subdivisions.length) console.log(`migrate-wiki: seeded ${subdivisions.length} subdivision articles`)
}

async function seedPositionOwners(conn, authorId, articleIds) {
  const positions = await conn.query('SELECT id, code, name FROM positions')
  if (!positions.length) return

  for (const article of ARTICLES) {
    if (!article.positionCodes?.length) continue
    const articleId = articleIds.get(`${article.space}/${article.slug}`)
    if (!articleId) continue

    const match = findPosition(positions, article.positionCodes)
    if (!match) continue

    await conn.query(
      'UPDATE wiki_articles SET owner_position_id = ? WHERE id = ? AND owner_position_id IS NULL',
      [Number(match.id), articleId],
    )
    await insertGrant(conn, 'article', articleId, 'position', Number(match.id), '', 'write', authorId)
  }

  console.log('migrate-wiki: linked Ämter to their articles')
}

async function seedChecklists(conn, articleIds) {
  for (const checklist of CHECKLISTS) {
    const articleId = articleIds.get(`${checklist.space}/${checklist.articleSlug}`)
    if (!articleId) continue

    await conn.query(
      'INSERT IGNORE INTO wiki_checklists (article_id, key_slug, title, mode) VALUES (?, ?, ?, ?)',
      [articleId, checklist.keySlug, checklist.title, checklist.mode],
    )

    const rows = await conn.query(
      'SELECT id FROM wiki_checklists WHERE article_id = ? AND key_slug = ? LIMIT 1',
      [articleId, checklist.keySlug],
    )
    if (!rows.length) continue
    const checklistId = Number(rows[0].id)

    const existing = await conn.query(
      'SELECT COUNT(*) AS item_count FROM wiki_checklist_items WHERE checklist_id = ?',
      [checklistId],
    )
    if (Number(existing[0]?.item_count ?? 0) > 0) continue

    let position = 0
    for (const item of checklist.items) {
      await conn.query(
        `INSERT INTO wiki_checklist_items (checklist_id, label, hint, target_page, target_meta, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          checklistId,
          item.label,
          item.hint ?? '',
          item.targetPage ?? null,
          item.targetPage ? JSON.stringify({ returnTarget: 'self', ...(item.targetMeta ?? {}) }) : null,
          position,
        ],
      )
      position += 1
    }
  }

  console.log('migrate-wiki: seeded checklists')
}

async function seedGlossary(conn, articleIds) {
  for (const entry of GLOSSARY) {
    const articleId = articleIds.get(`${entry.articleSpace}/${entry.articleSlug}`) ?? null

    await conn.query(
      'INSERT IGNORE INTO wiki_glossary_terms (term, short_definition, article_id) VALUES (?, ?, ?)',
      [entry.term, entry.definition, articleId],
    )

    const rows = await conn.query('SELECT id FROM wiki_glossary_terms WHERE term = ? LIMIT 1', [entry.term])
    if (!rows.length) continue

    for (const alias of entry.aliases) {
      await conn.query(
        'INSERT IGNORE INTO wiki_glossary_aliases (term_id, alias) VALUES (?, ?)',
        [Number(rows[0].id), alias],
      )
    }
  }

  console.log(`migrate-wiki: seeded ${GLOSSARY.length} glossary terms`)
}

async function seedPaths(conn, articleIds) {
  const positions = await conn.query('SELECT id, code, name FROM positions')

  for (const path of PATHS) {
    await conn.query(
      `INSERT IGNORE INTO wiki_paths (slug, title, description, icon, position, is_published)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [path.slug, path.title, path.description, path.icon, path.position],
    )

    const rows = await conn.query('SELECT id FROM wiki_paths WHERE slug = ? LIMIT 1', [path.slug])
    if (!rows.length) continue
    const pathId = Number(rows[0].id)

    const existing = await conn.query(
      'SELECT COUNT(*) AS item_count FROM wiki_path_items WHERE path_id = ?',
      [pathId],
    )
    if (Number(existing[0]?.item_count ?? 0) === 0) {
      let position = 0
      for (const item of path.items) {
        const articleId = articleIds.get(`${item.space}/${item.slug}`)
        if (!articleId) continue
        await conn.query(
          'INSERT INTO wiki_path_items (path_id, article_id, position, note) VALUES (?, ?, ?, ?)',
          [pathId, articleId, position, item.note ?? ''],
        )
        position += 1
      }
    }

    if (!path.audiencePositionCodes?.length) continue
    const match = findPosition(positions, path.audiencePositionCodes)
    if (!match) continue

    const audience = await conn.query(
      'SELECT id FROM wiki_path_audiences WHERE path_id = ? AND position_id = ? LIMIT 1',
      [pathId, Number(match.id)],
    )
    if (!audience.length) {
      await conn.query(
        'INSERT INTO wiki_path_audiences (path_id, position_id) VALUES (?, ?)',
        [pathId, Number(match.id)],
      )
    }
  }

  console.log(`migrate-wiki: seeded ${PATHS.length} learning paths`)
}

async function seedPageHelp(conn, articleIds) {
  for (const entry of PAGE_HELP) {
    const articleId = articleIds.get(`${entry.space}/${entry.slug}`)
    if (!articleId) continue

    await conn.query(
      `INSERT IGNORE INTO wiki_page_help (page_name, section_key, article_id, position)
       VALUES (?, ?, ?, ?)`,
      [entry.page, entry.section ?? '', articleId, entry.position ?? 0],
    )
  }

  console.log('migrate-wiki: seeded page help mapping')
}

async function seedContent(conn) {
  const userRows = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1')
  if (!userRows.length) {
    console.warn('migrate-wiki: no users yet, skipping the seed content (run this migration again after seed-admin)')
    return
  }
  const authorId = Number(userRows[0].id)

  const { articleIds, spaceIdBySlug } = await seedArticles(conn, authorId)
  await seedSubdivisionArticles(conn, authorId, articleIds, spaceIdBySlug)
  await seedPositionOwners(conn, authorId, articleIds)
  await seedChecklists(conn, articleIds)
  await seedGlossary(conn, articleIds)
  await seedPaths(conn, articleIds)
  await seedPageHelp(conn, articleIds)
}

const SEED_CONTENT = process.argv.includes('--seed-content') || process.env.WIKI_SEED_CONTENT === '1'

async function migrateWiki() {
  const migrationUser = DB_AUDIT_SETUP_USER || DB_USER
  const migrationPassword = DB_AUDIT_SETUP_USER
    ? (DB_AUDIT_SETUP_PASSWORD ?? '')
    : DB_PASSWORD

  const pool = mariadb.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: migrationUser,
    password: migrationPassword,
    database: DB_NAME,
    connectionLimit: Number(DB_CONN_LIMIT),
    timezone: 'UTC',
  })

  let conn

  try {
    conn = await pool.getConnection()
    const rows = await conn.query('SELECT DATABASE() AS db_name')
    const databaseName = rows[0]?.db_name?.trim()
    if (!databaseName) throw new Error('Failed to resolve current database name')

    for (const [tableName, statement] of TABLES) {
      const existed = await tableExists(conn, databaseName, tableName)
      await conn.query(statement)
      if (!existed) console.log(`migrate-wiki: created ${tableName}`)
    }

    await ensureFulltextIndex(conn, databaseName)
    await grantPermissions(conn)

    if (SEED_CONTENT) {
      await seedSpaces(conn)
      await seedContent(conn)
    } else {
      console.log('migrate-wiki: skipped example content (pass --seed-content to seed it)')
    }

    console.log('migrate-wiki: complete')
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateWiki().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-wiki: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-wiki: failed', error)
  process.exit(1)
})
