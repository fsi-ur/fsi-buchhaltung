import type * as mariadb from 'mariadb'

type QueryHandler = (sql: string, params?: unknown[]) => unknown

let handler: QueryHandler | null = null

export function setQueryHandler(next: QueryHandler) {
  handler = next
}

export function setQueryResults(results: unknown[]) {
  const queue = [...results]
  handler = () => {
    if (!queue.length) throw new Error('db stub: more queries were made than results queued')
    return queue.shift()
  }
}

export function resetDbStub() {
  handler = null
}

function refuse(fn: string): never {
  throw new Error(
    `db stub: ${fn}() was called in a unit test without a handler. `
    + 'Register one with setQueryHandler()/setQueryResults(), or move the test to tests/db/.',
  )
}

export async function query<T = any>(sql: string, params?: unknown[], _conn?: mariadb.PoolConnection): Promise<T> {
  if (!handler) refuse('query')
  return handler(sql, params) as T
}

export async function getDbConnection(): Promise<never> {
  refuse('getDbConnection')
}

export async function withTransaction<T>(callback: (conn: any) => Promise<T>): Promise<T> {
  if (!handler) refuse('withTransaction')
  return callback(null)
}

export async function withAuditTransaction<T>(_actor: unknown, callback: (conn: any) => Promise<T>): Promise<T> {
  if (!handler) refuse('withAuditTransaction')
  return callback(null)
}
