import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import type { CompanyRow, UpdateCompanyBody } from '~/types/company'
import { internalError } from '~/server/utils/api/errors'

interface UpdateCompanySuccess {
  ok: true
}

interface UpdateCompanyError {
  ok: false
  error: string
}

type UpdateCompanyResponse = UpdateCompanySuccess | UpdateCompanyError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<UpdateCompanyResponse> => {
  const current = await requirePermission(event, 'companies.edit', { touch: false })
  if (!current.ok) return current

  const companyId = getNumericRouteParam(event)
  if (!companyId) return { ok: false, error: 'Invalid company id' }

  const body = await readBody<UpdateCompanyBody>(event)
  if (!body.name) return { ok: false, error: 'Missing fields' }
  const updated = body

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows: CompanyRow[] = await query(
        `SELECT * FROM companies WHERE id = ? LIMIT 1`,
        [companyId],
        conn
      )

      if (!existingRows.length) return { ok: false, error: 'No matching companies in database' }
      await query(
        `UPDATE companies
        SET
          name = ?,
          street = ?,
          street_number = ?,
          postal_code = ?,
          city = ?,
          country = ?,
          iban = ?,
          bic = ?,
          bankname = ?,
          vat_id = ?,
          email = ?,
          phone = ?,
          notes = ?
        WHERE id = ?`,
        [
          updated.name,
          updated.street || null,
          updated.street_number || null,
          updated.postal_code || null,
          updated.city || null,
          updated.country || null,
          updated.iban || null,
          updated.bic || null,
          updated.bankname || null,
          updated.vat_id || null,
          updated.email || null,
          updated.phone || null,
          updated.notes || null,
          companyId,
        ],
        conn
      )

      return { ok: true }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    return internalError('An error occured while updating the company', err)
  }
})
