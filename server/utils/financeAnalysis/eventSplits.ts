import { query } from '~/server/utils/db'
import type { FinanceAnalysisCostCentreSplit } from '~/types/financeAnalysis'

export async function loadEventCostCentreSplits(eventIds: number[]) {
  const uniqueIds = Array.from(new Set(eventIds.filter(id => Number.isFinite(id) && id > 0)))
  if (!uniqueIds.length) return new Map<number, FinanceAnalysisCostCentreSplit[]>()

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const rows: any[] = await query(
    `
    SELECT
      eccs.event_id,
      eccs.sphere_id,
      s.code AS sphere_code,
      s.name AS sphere_name,
      eccs.cost_centre_id,
      cc.code,
      cc.name,
      eccs.allocation_percentage
    FROM event_cost_centre_splits eccs
    INNER JOIN spheres s ON s.id = eccs.sphere_id
    INNER JOIN cost_centres cc ON cc.id = eccs.cost_centre_id
    WHERE eccs.event_id IN (${placeholders})
    ORDER BY s.code ASC, s.name ASC, cc.code ASC, cc.name ASC
    `,
    uniqueIds,
  )

  const splitsByEventId = new Map<number, FinanceAnalysisCostCentreSplit[]>()

  for (const row of rows) {
    const eventId = Number(row.event_id)
    const current = splitsByEventId.get(eventId) ?? []
    current.push({
      sphere_id: Number(row.sphere_id),
      sphere_code: String(row.sphere_code || ''),
      sphere_name: String(row.sphere_name || ''),
      cost_centre_id: Number(row.cost_centre_id),
      code: String(row.code || ''),
      name: String(row.name || ''),
      allocation_percentage: Number(row.allocation_percentage || 0),
    })
    splitsByEventId.set(eventId, current)
  }

  return splitsByEventId
}
