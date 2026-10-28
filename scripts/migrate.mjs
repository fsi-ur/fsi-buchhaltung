import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MIGRATION_SCRIPTS } from './migration-list.mjs'

/**
 * Runs every migration in MIGRATION_SCRIPTS order, then rebuilds the audit infrastructure (its
 * triggers cover the columns of every table, so it has to see the final schema). Stops at the first
 * failure. Each step runs as its own process with this process's environment, so
 * `node --env-file=.env scripts/migrate.mjs` and the container's env both work.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const steps = [...MIGRATION_SCRIPTS, 'ensure-audit-infrastructure.mjs']

for (const [index, file] of steps.entries()) {
  console.log(`migrate: [${index + 1}/${steps.length}] ${file}`)
  const result = spawnSync(process.execPath, [path.join(scriptDir, file)], {
    env: process.env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`migrate: ${file} failed${result.error ? ` (${result.error.message})` : ''} — stopping`)
    process.exit(result.status || 1)
  }
}

console.log(`migrate: complete (${MIGRATION_SCRIPTS.length} migrations + audit infrastructure)`)
