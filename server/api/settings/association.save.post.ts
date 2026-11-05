import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import {
  normalizeAssociationProfileBody,
  syncAssociationResponsibleMembers,
  syncAssociationResponsiblePositions,
  validateAssociationReferences,
  validateAssociationProfilePayload,
} from '~/server/utils/association'
import { query, withAuditTransaction } from '~/server/utils/db'
import { checkUploadedImageDimensions } from '~/server/utils/imageLimits'
import { detachFileAttachment, getActiveFileAttachment, storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { AssociationProfileRow } from '~/types/association'
import { internalError } from '~/server/utils/api/errors'

interface SaveAssociationProfileSuccess {
  ok: true
  id: number
}

interface SaveAssociationProfileError {
  ok: false
  error: string
}

type SaveAssociationProfileResponse = SaveAssociationProfileSuccess | SaveAssociationProfileError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<SaveAssociationProfileResponse> => {
  const current = await requirePermission(event, 'settings.association.manage', { touch: false })
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Invalid payload' }

  const rawProfile = multipart.getField('profile')
  if (!rawProfile) return { ok: false, error: 'Invalid payload' }
  const rawBody = JSON.parse(rawProfile) as Record<string, unknown>
  const updated = normalizeAssociationProfileBody(rawBody)
  const validationError = validateAssociationProfilePayload(updated)
  if (validationError) return { ok: false, error: validationError }
  if (!updated) return { ok: false, error: 'Invalid payload' }
  const removeExistingLogo = multipart.getField('removeExistingLogo') === 'true'
  const logoError = multipart.file
    ? validateUploadedFile(multipart.file)
    : null
  if (logoError) return { ok: false, error: logoError }
  const logoDimensionError = multipart.file ? checkUploadedImageDimensions(multipart.file.data) : null
  if (logoDimensionError) return { ok: false, error: logoDimensionError }
  if (multipart.file && !String(multipart.file.type || '').startsWith('image/')) {
    return { ok: false, error: 'Association logo must be an image file' }
  }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const referenceValidation = await validateAssociationReferences({
        memberIds: updated.responsible_member_ids,
        positionIds: updated.responsible_position_ids,
        conn,
      })
      if (!referenceValidation.ok) return referenceValidation

      const existingRows = normalizeBigInt(await query<AssociationProfileRow[]>(`
        SELECT
          id, name, short_name, street, street_number, postal_code, city, email, phone, website,
          vat_id, iban, bic, bankname, register_number, register_court, NULL AS logo_file_id
        FROM association_profiles
        ORDER BY id ASC
        LIMIT 1
      `, [], conn)) as AssociationProfileRow[]

      const existing = existingRows[0] ?? null

      if (existing) {
        const existingLogoAttachment = await getActiveFileAttachment('association_profile_logo', existing.id, conn)
        const existingMemberRows = normalizeBigInt(await query<{ member_id: number }[]>(
          `SELECT member_id
           FROM association_responsible_members
           WHERE association_profile_id = ?
           ORDER BY member_id ASC`,
          [existing.id],
          conn,
        )) as { member_id: number }[]
        const existingPositionRows = normalizeBigInt(await query<{ position_id: number }[]>(
          `SELECT position_id
           FROM association_responsible_positions
           WHERE association_profile_id = ?
           ORDER BY position_id ASC`,
          [existing.id],
          conn,
        )) as { position_id: number }[]

        await query(
          `UPDATE association_profiles
           SET
             name = ?,
             short_name = ?,
             street = ?,
             street_number = ?,
             postal_code = ?,
             city = ?,
             email = ?,
             phone = ?,
             website = ?,
             vat_id = ?,
             iban = ?,
             bic = ?,
             bankname = ?,
             register_number = ?,
             register_court = ?
           WHERE id = ?`,
          [
            updated.name,
            updated.short_name,
            updated.street,
            updated.street_number,
            updated.postal_code,
            updated.city,
            updated.email,
            updated.phone,
            updated.website,
            updated.vat_id,
            updated.iban,
            updated.bic,
            updated.bankname,
            updated.register_number,
            updated.register_court,
            existing.id,
          ],
          conn,
        )

        const memberSync = await syncAssociationResponsibleMembers({
          profileId: existing.id,
          existingIds: existingMemberRows.map(row => Number(row.member_id)),
          nextIds: updated.responsible_member_ids,
          userId: current.user.id,
          conn,
        })
        if (!memberSync.ok) return memberSync

        const positionSync = await syncAssociationResponsiblePositions({
          profileId: existing.id,
          existingIds: existingPositionRows.map(row => Number(row.position_id)),
          nextIds: updated.responsible_position_ids,
          userId: current.user.id,
          conn,
        })
        if (!positionSync.ok) return positionSync

        const shouldReplaceLogo = Boolean(existingLogoAttachment) && (removeExistingLogo || Boolean(multipart.file))
        if (shouldReplaceLogo && existingLogoAttachment) {
          await detachFileAttachment(existingLogoAttachment.id, current.user.id, conn)
        }

        if (multipart.file) {
          await storeAndAttachUploadedFile(
            multipart.file,
            'association',
            'association_profile_logo',
            existing.id,
            current.user.id,
            conn,
          )
        }

        return { ok: true, id: existing.id }
      }

      const res = await query<{ insertId: number }>(
        `INSERT INTO association_profiles (
          singleton_key, name, short_name, street, street_number, postal_code, city, email, phone, website,
          vat_id, iban, bic, bankname, register_number, register_court
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          1,
          updated.name,
          updated.short_name,
          updated.street,
          updated.street_number,
          updated.postal_code,
          updated.city,
          updated.email,
          updated.phone,
          updated.website,
          updated.vat_id,
          updated.iban,
          updated.bic,
          updated.bankname,
          updated.register_number,
          updated.register_court,
        ],
        conn,
      )

      const profileId = Number(normalizeBigInt(res.insertId))

      for (const memberId of updated.responsible_member_ids) {
        await query(
          `INSERT INTO association_responsible_members (association_profile_id, member_id)
           VALUES (?, ?)`,
          [profileId, memberId],
          conn,
        )
      }

      for (const positionId of updated.responsible_position_ids) {
        await query(
          `INSERT INTO association_responsible_positions (association_profile_id, position_id)
           VALUES (?, ?)`,
          [profileId, positionId],
          conn,
        )
      }

      if (multipart.file) {
        await storeAndAttachUploadedFile(
          multipart.file,
          'association',
          'association_profile_logo',
          profileId,
          current.user.id,
          conn,
        )
      }

      return { ok: true, id: profileId }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    return internalError('An error occured while saving the association profile', err)
  }
})
