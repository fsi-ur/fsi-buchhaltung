import { query } from '~/server/utils/db'

/**
 * Durable log of events that must outlive a snapshot restore (SEC-09). The table is excluded from
 * snapshots (SNAPSHOT_EXCLUDED_TABLES) and from the audit triggers, and the runtime DB user may only
 * read and append to it. Writing never fails the caller: the console line is the fallback.
 */
export async function recordSystemEvent(
  eventType: string,
  actor: { id: number, username?: string | null } | null,
  details: Record<string, unknown>,
) {
  console.warn(`system-event: ${eventType} by ${actor ? `user ${actor.id} (${actor.username ?? '?'})` : 'system'} ${JSON.stringify(details)}`)
  try {
    await query(
      `INSERT INTO system_events (event_type, actor_user_id, actor_username, details) VALUES (?, ?, ?, ?)`,
      [eventType, actor?.id ?? null, actor?.username ?? null, JSON.stringify(details)],
    )
  } catch (err) {
    console.error('system-event: could not be stored', err)
  }
}
