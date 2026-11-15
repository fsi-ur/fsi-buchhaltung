import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mariadb from 'mariadb'
import { assertTestDatabase } from './guard'

const root = fileURLToPath(new URL('../../', import.meta.url))

const REQUIRED_TABLES = ['users', 'appointments', 'entity_versions']

export default async function setup() {
  const envFile = path.join(root, '.env.test')
  if (!fs.existsSync(envFile)) {
    throw new Error('.env.test is missing. Copy .env.test.example to .env.test, then run `npm run test:db:setup`.')
  }
  process.loadEnvFile(envFile)

  const target = assertTestDatabase()

  let conn
  try {
    conn = await mariadb.createConnection({
      host: target.host,
      port: target.port,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: target.database,
      connectTimeout: 5000,
    })
  } catch (err) {
    throw new Error(
      `Cannot reach the test database at ${target.host}:${target.port}/${target.database}.\n`
      + '  Start it:  npm run test:db:up\n'
      + '  Build it:  npm run test:db:setup\n'
      + `  (${(err as Error).message})`,
    )
  }

  try {
    const rows = await conn.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [target.database],
    ) as Array<{ name: string }>
    const present = new Set(rows.map(row => row.name))
    const missing = REQUIRED_TABLES.filter(table => !present.has(table))

    if (missing.length) {
      throw new Error(
        `The test database is missing tables (${missing.join(', ')}).\n`
        + '  Build the schema:  npm run test:db:setup',
      )
    }

    const triggers = await conn.query(
      `SELECT COUNT(*) AS count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?`,
      [target.database],
    ) as Array<{ count: number }>

    if (Number(triggers[0]?.count ?? 0) === 0) {
      throw new Error(
        'The test database has no audit triggers — audit tests would silently pass.\n'
        + '  Run:  npm run test:db:setup',
      )
    }

    // `resetDatabase()` empties tables with DELETE between tests, which keeps every auto-increment
    // counter running — across runs, too, until a small key (spheres.id is a TINYINT) overflows.
    // Once per run, TRUNCATE empties everything and restarts the counters at 1 (fast, and it fires
    // no audit triggers). Within a run ids keep growing, so audit rows never meet a reused id.
    const baseTables = await conn.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [target.database],
    ) as Array<{ name: string }>
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    try {
      for (const { name } of baseTables) await conn.query(`TRUNCATE TABLE \`${name}\``)
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1')
    }
  } finally {
    await conn.end()
  }
}
