import type * as mariadb from 'mariadb'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'
import { query } from '~/server/utils/db'
import { normalizeRelationIds } from '~/server/utils/subdivisions'

interface NamedRow {
  id: number
  label: string
}

export function normalizeAssociationProfileBody(body: Record<string, unknown>) {
  const memberIds = normalizeRelationIds(body.responsible_member_ids)
  const positionIds = normalizeRelationIds(body.responsible_position_ids)

  if (memberIds === null || positionIds === null) return null

  return {
    id: Number(body.id) > 0 ? Number(body.id) : undefined,
    name: String(body.name || '').trim(),
    short_name: normalizeOptionalString(body.short_name),
    street: String(body.street || '').trim(),
    street_number: String(body.street_number || '').trim(),
    postal_code: String(body.postal_code || '').trim(),
    city: String(body.city || '').trim(),
    email: String(body.email || '').trim(),
    phone: normalizeOptionalString(body.phone),
    website: normalizeOptionalString(body.website),
    vat_id: normalizeOptionalString(body.vat_id),
    register_number: normalizeOptionalString(body.register_number),
    register_court: normalizeOptionalString(body.register_court),
    responsible_member_ids: memberIds,
    responsible_position_ids: positionIds,
  }
}

export function validateAssociationProfilePayload(body: ReturnType<typeof normalizeAssociationProfileBody>) {
  if (!body) return 'Invalid payload'
  if (!body.name || !body.street || !body.street_number || !body.postal_code || !body.city || !body.email) {
    return 'Missing fields'
  }
  return null
}

function normalizeOptionalString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function getAssociationMemberLabels(
  memberIds: number[],
  conn: mariadb.PoolConnection,
) {
  if (!memberIds.length) return new Map<number, string>()

  const rows = await query<NamedRow[]>(
    `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS label
     FROM members
     WHERE id IN (${memberIds.map(() => '?').join(',')})`,
    memberIds,
    conn,
  )

  return new Map(rows.map(row => [Number(row.id), String(row.label)]))
}

export async function getAssociationPositionLabels(
  positionIds: number[],
  conn: mariadb.PoolConnection,
) {
  if (!positionIds.length) return new Map<number, string>()

  const rows = await query<NamedRow[]>(
    `SELECT id, TRIM(CONCAT(code, ' - ', name)) AS label
     FROM positions
     WHERE id IN (${positionIds.map(() => '?').join(',')})`,
    positionIds,
    conn,
  )

  return new Map(rows.map(row => [Number(row.id), String(row.label)]))
}

export async function validateAssociationReferences({
  memberIds,
  positionIds,
  conn,
}: {
  memberIds: number[]
  positionIds: number[]
  conn: mariadb.PoolConnection
}) {
  const [memberLabels, positionLabels] = await Promise.all([
    getAssociationMemberLabels(memberIds, conn),
    getAssociationPositionLabels(positionIds, conn),
  ])

  if (memberLabels.size !== new Set(memberIds).size) {
    return { ok: false as const, error: 'One or more selected members do not exist' }
  }

  if (positionLabels.size !== new Set(positionIds).size) {
    return { ok: false as const, error: 'One or more selected positions do not exist' }
  }

  return { ok: true as const }
}

export async function syncAssociationResponsibleMembers({
  profileId,
  existingIds,
  nextIds,
  userId,
  conn,
}: {
  profileId: number
  existingIds: number[]
  nextIds: number[]
  userId: number
  conn: mariadb.PoolConnection
}) {
  const labels = await getAssociationMemberLabels(Array.from(new Set([...existingIds, ...nextIds])), conn)
  if (labels.size !== new Set([...existingIds, ...nextIds]).size) {
    return { ok: false as const, error: 'One or more selected members do not exist' }
  }

  await syncScalarCollection({
    existing: existingIds,
    incoming: nextIds,
    onRemove: async (memberId) => {
      await query(
        `DELETE FROM association_responsible_members
         WHERE association_profile_id = ? AND member_id = ?`,
        [profileId, memberId],
        conn,
      )
    },
    onAdd: async (memberId) => {
      await query(
        `INSERT INTO association_responsible_members (association_profile_id, member_id)
         VALUES (?, ?)`,
        [profileId, memberId],
        conn,
      )
    },
  })

  return { ok: true as const }
}

export async function syncAssociationResponsiblePositions({
  profileId,
  existingIds,
  nextIds,
  userId,
  conn,
}: {
  profileId: number
  existingIds: number[]
  nextIds: number[]
  userId: number
  conn: mariadb.PoolConnection
}) {
  const labels = await getAssociationPositionLabels(Array.from(new Set([...existingIds, ...nextIds])), conn)
  if (labels.size !== new Set([...existingIds, ...nextIds]).size) {
    return { ok: false as const, error: 'One or more selected positions do not exist' }
  }

  await syncScalarCollection({
    existing: existingIds,
    incoming: nextIds,
    onRemove: async (positionId) => {
      await query(
        `DELETE FROM association_responsible_positions
         WHERE association_profile_id = ? AND position_id = ?`,
        [profileId, positionId],
        conn,
      )
    },
    onAdd: async (positionId) => {
      await query(
        `INSERT INTO association_responsible_positions (association_profile_id, position_id)
         VALUES (?, ?)`,
        [profileId, positionId],
        conn,
      )
    },
  })

  return { ok: true as const }
}
