import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, implied, type PermissionKey } from '~/config/permissions'
import { messages } from '~/shared/i18n'
import { MIGRATION_SCRIPTS } from '~/scripts/migration-list.mjs'

/**
 * Guards for the cross-file invariants this codebase depends on but no type can express:
 * a permission that exists in TypeScript but not in the plain-JS admin seeder, a page
 * gated on a permission that was renamed, a German string with no English counterpart, a
 * migration added to package.json but forgotten in docker-compose.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function sourceFiles(dir: string): string[] {
  const absolute = path.join(root, dir)
  if (!fs.existsSync(absolute)) return []
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(relative)
    return /\.(ts|vue|mjs)$/.test(entry.name) ? [relative] : []
  })
}

function collectKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  if (!node || typeof node !== 'object') return []

  return Object.entries(node as Record<string, unknown>)
    .flatMap(([key, value]) => collectKeys(value, prefix ? `${prefix}.${key}` : key))
}

describe('permissions', () => {
  const permissionKeys = PERMISSIONS.map(permission => permission.key)

  it('has no duplicate keys', () => {
    expect(new Set(permissionKeys).size).toBe(permissionKeys.length)
  })

  it('gives every permission a label and category key', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.labelKey, permission.key).toBeTruthy()
      expect(permission.categoryKey, permission.key).toBeTruthy()
    }
  })

  it('labels every permission in both languages', () => {
    const de = new Set(collectKeys(messages.de))
    const en = new Set(collectKeys(messages.en))

    for (const permission of PERMISSIONS) {
      expect(de.has(permission.labelKey), `de: ${permission.labelKey}`).toBe(true)
      expect(en.has(permission.labelKey), `en: ${permission.labelKey}`).toBe(true)
      expect(de.has(permission.categoryKey), `de: ${permission.categoryKey}`).toBe(true)
    }
  })

  it('only implies permissions that exist', () => {
    const known = new Set<string>(permissionKeys)
    for (const [key, impliedKeys] of Object.entries(implied)) {
      expect(known.has(key), `implied source ${key}`).toBe(true)
      for (const impliedKey of impliedKeys ?? []) {
        expect(known.has(impliedKey), `${key} implies unknown ${impliedKey}`).toBe(true)
      }
    }
  })

  it('never implies itself, directly or in a cycle', () => {
    // getUserPermissions expands `implied` in a fixpoint loop; a cycle would not hang it,
    // but it does signal a modelling mistake worth failing on.
    for (const key of Object.keys(implied) as PermissionKey[]) {
      const seen = new Set<string>()
      const stack = [...(implied[key] ?? [])]
      while (stack.length) {
        const next = stack.pop()!
        expect(next, `${key} implies itself`).not.toBe(key)
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(...(implied[next as PermissionKey] ?? []))
      }
    }
  })

  /**
   * scripts/seed-admin.mjs cannot import the TypeScript union, so it keeps its own copy of
   * the key list. A key missing there means the bootstrapped admin silently lacks it.
   */
  it('is mirrored completely in scripts/seed-admin.mjs', () => {
    const source = read('scripts/seed-admin.mjs')
    const block = source.match(/const ALL_PERMISSION_KEYS = \[([\s\S]*?)\]/)
    expect(block, 'ALL_PERMISSION_KEYS not found in scripts/seed-admin.mjs').toBeTruthy()

    const seeded = new Set([...block![1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!))

    const missing = permissionKeys.filter(key => !seeded.has(key))
    const stale = [...seeded].filter(key => !permissionKeys.includes(key as PermissionKey))

    expect(missing, 'missing from seed-admin.mjs').toEqual([])
    expect(stale, 'no longer a PermissionKey').toEqual([])
  })
})

describe('pages', () => {
  // config/pages.ts imports .vue components, which this project cannot load without the
  // Nuxt/Vite pipeline, so the permission references are read from the source text.
  const source = read('config/pages.ts')
  const permissionKeys = new Set<string>(PERMISSIONS.map(permission => permission.key))

  it('only gates pages on permissions that exist', () => {
    const entries = [...source.matchAll(/permissions:\s*\[([^\]]*)\]/g)]
    expect(entries.length).toBeGreaterThan(0)

    const referenced = entries.flatMap(entry => [...entry[1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!))
    const unknown = [...new Set(referenced)].filter(key => !permissionKeys.has(key))

    expect(unknown, 'permissions referenced in config/pages.ts but not in config/permissions.ts').toEqual([])
  })

  const definitions = [...source.matchAll(/^\s{2}(\w+):\s*\{(.+)\},?$/gm)]

  // layouts/default.vue renders `main: true` pages as the top-level menu and the file
  // itself says not to exceed eight. Guest-only pages (Login) are never shown next to the
  // others, so they do not count against the budget.
  it('keeps at most 8 main pages for a signed-in user', () => {
    const mainPages = definitions.filter(([, , body]) =>
      /main:\s*true/.test(body!) && !/allowGuest:\s*true/.test(body!))

    expect(mainPages.map(([, name]) => name).length).toBeLessThanOrEqual(8)
  })

  it('gives every main page an icon', () => {
    expect(definitions.length).toBeGreaterThan(0)

    for (const [, name, body] of definitions) {
      if (!/main:\s*true/.test(body!)) continue
      expect(/icon:\s*'/.test(body!), `main page ${name} has no icon`).toBe(true)
    }
  })
})

describe('i18n', () => {
  const deKeys = collectKeys(messages.de)
  const enKeys = collectKeys(messages.en)

  it('translates every German key into English', () => {
    const missing = deKeys.filter(key => !new Set(enKeys).has(key))
    expect(missing, 'keys present in de but missing in en').toEqual([])
  })

  it('has no English key without a German original', () => {
    // German is the source of truth, so a stray English-only key is dead weight.
    const missing = enKeys.filter(key => !new Set(deKeys).has(key))
    expect(missing, 'keys present in en but missing in de').toEqual([])
  })

  // Deliberately blank: a custom notification starts from an empty subject and body.
  const INTENTIONALLY_EMPTY = [
    'notifications.types.custom.message.subject',
    'notifications.types.custom.message.body',
  ]

  it('leaves no message empty by accident', () => {
    const empty = deKeys.filter((key) => {
      if (INTENTIONALLY_EMPTY.includes(key)) return false
      const value = key.split('.').reduce<any>((node, segment) => node?.[segment], messages.de)
      return typeof value === 'string' && value.trim() === ''
    })
    expect(empty, 'empty German messages').toEqual([])
  })
})

describe('migrations', () => {
  const compose = read('docker-compose.yml')
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('lists only scripts that exist', () => {
    for (const file of MIGRATION_SCRIPTS) {
      expect(fs.existsSync(path.join(root, 'scripts', file)), file).toBe(true)
    }
  })

  it('lists every migrate-*.mjs script in scripts/', () => {
    const onDisk = fs.readdirSync(path.join(root, 'scripts'))
      .filter(file => file.startsWith('migrate-') && file.endsWith('.mjs'))

    expect([...onDisk].sort(), 'scripts/migration-list.mjs is out of date')
      .toEqual([...MIGRATION_SCRIPTS].sort())
  })

  /**
   * The `app` service in docker-compose.yml runs the migrations on every deploy. It must go
   * through scripts/migrate.mjs (which walks the shared list) rather than naming scripts itself,
   * or a fresh install and the test database get different schemas -- exactly the kind of drift
   * that makes a green test run worthless.
   */
  it('runs them in docker-compose.yml through scripts/migrate.mjs only', () => {
    const command = compose.match(/command:\s*sh -c "([^"]+)"/)?.[1]
    expect(command, 'app service command not found in docker-compose.yml').toBeTruthy()

    expect(command).toContain('node scripts/migrate.mjs')
    expect(command!.match(/scripts\/migrate-[\w-]+\.mjs/g) ?? []).toEqual([])
  })

  it('runs the audit setup after every migration', () => {
    const migrate = read('scripts/migrate.mjs')
    expect(migrate).toContain('[...MIGRATION_SCRIPTS, \'ensure-audit-infrastructure.mjs\']')
  })

  it('exposes setup:migrate as the full migration run', () => {
    expect(packageJson.scripts['setup:migrate']).toContain('scripts/migrate.mjs')
  })

  it('exposes a setup:migrate script in package.json for each migration', () => {
    const referenced = new Set(
      Object.values(packageJson.scripts)
        .flatMap(script => [...script.matchAll(/scripts\/(migrate-[\w-]+\.mjs)/g)].map(match => match[1]!)),
    )

    const missing = MIGRATION_SCRIPTS.filter(file => !referenced.has(file))
    expect(missing, 'migrations with no npm script').toEqual([])
  })
})

describe('time zones', () => {
  // The time model is in shared/time.ts: TIMESTAMP = instant, DATETIME/DATE = wall clock / day in the
  // app time zone (`app_time_zone` setting). These patterns read the zone of whatever machine the code
  // happens to run on — the UTC session of the DB, the Node process, the viewer's browser — instead.
  const SOURCE_DIRS = ['components', 'composables', 'layouts', 'plugins', 'server', 'shared', 'utils']
  const ALLOWED_FILES = new Set(['shared/time.ts'])

  const files = SOURCE_DIRS.flatMap(sourceFiles).filter(file => !ALLOWED_FILES.has(file))

  function offenders(pattern: RegExp, onlyIn?: (file: string) => boolean) {
    return files
      .filter(file => !onlyIn || onlyIn(file))
      .flatMap(file => read(file).split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => pattern.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line))
        .map(({ index }) => `${file}:${index + 1}`))
  }

  it('never hard-codes the association\'s zone — it comes from the app_time_zone setting', () => {
    expect(offenders(/['"`]Europe\/Berlin['"`]/)).toEqual([])
  })

  it('never takes "today" as the UTC date of an instant', () => {
    expect(offenders(/toISOString\(\)\.(slice|substring)\(0, ?10\)|toISOString\(\)\.split\(['"]T['"]\)/)).toEqual([])
  })

  it('never lets SQL pick "now" or "today" in the session\'s UTC', () => {
    const isServer = (file: string) => file.startsWith('server/')
    // Upper-case SQL only, and not a method call — `Date.now()` is fine, it is an instant.
    expect(offenders(/(?<![.\w])(NOW|CURDATE|CURRENT_DATE|CURTIME|UTC_TIMESTAMP|LOCALTIME|SYSDATE)\(\)|(?<![.\w])CURRENT_DATE(?!\w)/, isServer)).toEqual([])
  })
})

describe('typed fetch', () => {
  // A call through the global `$fetch` makes TypeScript match its URL against every server
  // route and resolve the handlers' return types; with this many routes that exceeds the
  // instantiation depth (TS2589) and fails typecheck at an unrelated call as soon as a route
  // is added. `apiFetch` (utils/apiFetch.ts) takes the response type as given instead.
  const CLIENT_DIRS = ['components', 'composables', 'layouts', 'plugins', 'utils']
  const ALLOWED_FILES = new Set(['utils/apiFetch.ts', 'plugins/auth-fetch.client.ts'])

  it('calls the API through apiFetch, not the route-typed global $fetch', () => {
    const offenders = CLIENT_DIRS.flatMap(sourceFiles)
      .filter(file => !ALLOWED_FILES.has(file))
      .flatMap(file => read(file).split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /(?<![\w.])\$fetch\b/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line))
        .map(({ index }) => `${file}:${index + 1}`))
    expect(offenders).toEqual([])
  })
})
