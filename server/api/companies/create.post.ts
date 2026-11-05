import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import type { CreateCompanyBody } from '~/types/company'
import { internalError } from '~/server/utils/api/errors'

interface CreateCompanySuccess {
  ok: true
  id: number
}

interface CreateCompanyError {
  ok: false
  error: string
}

type CreateCompanyResponse = CreateCompanySuccess | CreateCompanyError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<CreateCompanyResponse> => {
  const current = await requirePermission(event, 'companies.edit', { touch: false })
  if (!current.ok) return current

  const body = await readBody<CreateCompanyBody>(event)
  if (!body.name) return { ok: false, error: 'Missing fields' }
  const { name, street, postal_code, city, country, iban, bic, bankname, vat_id, email, phone, notes } = body

  try {
    const res = await withAuditTransaction(current.user, async (conn) => query(
      `INSERT INTO companies (name, street, postal_code, city, country, iban, bic, bankname, vat_id, email, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, street, postal_code, city, country, iban, bic, bankname, vat_id, email, phone, notes],
      conn,
    ))

    return { ok: true, id: normalizeBigInt(res.insertId) }
  } catch (err: unknown) {
    const error = err as MysqlError
    return internalError('Failed to create company', error)
  }
})
