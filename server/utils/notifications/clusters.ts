import { addMinutesToLocalDateTime, normalizeLocalDateTime, type LocalDateTime } from '~/shared/time'

export interface ClusterItem {
  id: number
  /** Wall clock the lead time counts back from (shift start, task deadline). */
  start: LocalDateTime
  /** Wall clock the item is over; equal to `start` for point-in-time items such as deadlines. */
  end: LocalDateTime
}

export interface LeadTimeCluster {
  /** The earliest item — the only one whose reminder is actually sent. */
  leaderId: number
  ids: number[]
}

/**
 * Groups dated items so a lead-time reminder goes out once per group instead of once per item:
 * someone with four shifts on one evening gets one "your shifts start tomorrow" listing all four
 * rather than four separate messages.
 *
 * Items are walked in start order; an item joins the current group when its own reminder would fire
 * before the group is over —
 *  - `span`: before the group's latest `end` (shifts: never remind someone about their next shift
 *    while they are still on one of the same event, and never before their first one has started),
 *  - `leader`: before the group's first `start` (deadlines: only fold what is due within one lead
 *    time of the earliest deadline, so a week of daily deadlines does not chain into one message).
 *
 * The grouping only depends on the items themselves, not on the current time, so every reminder of
 * the group computes the same leader whenever it is processed — the leader's reminder lists the
 * group, the others are skipped.
 */
export function clusterByLeadTime(items: ClusterItem[], leadMinutes: number, mode: 'span' | 'leader'): LeadTimeCluster[] {
  const normalized = items
    .map(item => ({
      id: item.id,
      start: normalizeLocalDateTime(item.start) ?? String(item.start),
      end: normalizeLocalDateTime(item.end) ?? String(item.end),
    }))
    .sort((a, b) => (a.start === b.start ? a.id - b.id : a.start < b.start ? -1 : 1))

  const clusters: LeadTimeCluster[] = []
  let current: { cluster: LeadTimeCluster, horizon: string } | null = null

  for (const item of normalized) {
    const remindAt = addMinutesToLocalDateTime(item.start, -leadMinutes)

    if (current && remindAt < current.horizon) {
      current.cluster.ids.push(item.id)
      if (mode === 'span' && item.end > current.horizon) current.horizon = item.end
      continue
    }

    current = {
      cluster: { leaderId: item.id, ids: [item.id] },
      horizon: mode === 'span' ? item.end : item.start,
    }
    clusters.push(current.cluster)
  }

  return clusters
}

/** The group `id` belongs to, or null when it is not among `items`. */
export function findCluster(items: ClusterItem[], leadMinutes: number, mode: 'span' | 'leader', id: number): LeadTimeCluster | null {
  return clusterByLeadTime(items, leadMinutes, mode).find(cluster => cluster.ids.includes(id)) ?? null
}
