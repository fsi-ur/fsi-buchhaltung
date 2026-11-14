import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import {
  ensureDefaultFinanceAccount,
  loadFinanceAccount,
  normalizeFinanceAccountBody,
  validateFinanceAccountBody,
} from '~/server/utils/financeAccounts'
import { internalError } from '~/server/utils/api/errors'
import type { SaveFinanceAccountBody } from '~/types/financeAccount'

interface SaveFinanceAccountSuccess {
  ok: true
  id: number
}

interface SaveFinanceAccountError {
  ok: false
  error: string
}

export type SaveFinanceAccountResponse = SaveFinanceAccountSuccess | SaveFinanceAccountError

const DUPLICATE_NAME = 'Ein Konto mit diesem Namen existiert bereits.'

export default defineEventHandler(async (event): Promise<SaveFinanceAccountResponse> => {
  const current = await requirePermission(event, 'settings.association.manage', { touch: false })
  if (!current.ok) return current

  const body = normalizeFinanceAccountBody(await readBody<Partial<SaveFinanceAccountBody>>(event).catch(() => null))
  const validationError = validateFinanceAccountBody(body)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      // Serialises concurrent saves, so the default invariant cannot be broken by a race.
      await query(`SELECT id FROM finance_accounts FOR UPDATE`, [], conn)

      const duplicate = await query<Array<{ id: number }>>(
        `SELECT id FROM finance_accounts WHERE name = ? AND id <> ? LIMIT 1`,
        [body.name, body.id ?? 0],
        conn,
      )
      if (duplicate.length) return { ok: false as const, error: DUPLICATE_NAME }

      let accountId: number
      if (body.id) {
        const existing = await loadFinanceAccount(body.id, conn)
        if (!existing) return { ok: false as const, error: 'Das Konto wurde nicht gefunden.' }

        if (existing.is_default) {
          // The default is replaced by marking another account. Only when no other account could
          // take over may it be archived — archiving the last active account switches bank features off.
          const [successor] = await query<Array<{ id: number }>>(
            `SELECT id FROM finance_accounts WHERE id <> ? AND archived_at IS NULL AND iban IS NOT NULL LIMIT 1`,
            [body.id],
            conn,
          )
          if (successor && (body.archived || !body.iban)) {
            return {
              ok: false as const,
              error: body.archived
                ? 'Das Standardkonto kann nicht archiviert werden, solange ein anderes Konto mit IBAN aktiv ist. Lege zuerst ein anderes Konto als Standard fest.'
                : 'Das Standardkonto braucht eine IBAN. Lege zuerst ein anderes Konto als Standard fest.',
            }
          }
          if (body.archived || !body.iban) await query(`UPDATE finance_accounts SET is_default = 0 WHERE id = ?`, [body.id], conn)
        }

        await query(
          `UPDATE finance_accounts
             SET name = ?, account_type = ?, account_holder = ?, iban = ?, bic = ?, bankname = ?,
                 identifier = ?, notes = ?,
                 archived_at = ${body.archived ? 'COALESCE(archived_at, CURRENT_TIMESTAMP)' : 'NULL'}
           WHERE id = ?`,
          [body.name, body.account_type, body.account_holder, body.iban, body.bic, body.bankname, body.identifier, body.notes, body.id],
          conn,
        )
        accountId = body.id
      } else {
        const result = await query<{ insertId: number }>(
          `INSERT INTO finance_accounts
             (name, account_type, account_holder, iban, bic, bankname, identifier, notes, is_default, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ${body.archived ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
          [body.name, body.account_type, body.account_holder, body.iban, body.bic, body.bankname, body.identifier, body.notes],
          conn,
        )
        accountId = Number(result.insertId)
      }

      if (body.is_default) {
        await query(`UPDATE finance_accounts SET is_default = (id = ?)`, [accountId], conn)
      }
      await ensureDefaultFinanceAccount(conn)

      return { ok: true as const, id: accountId }
    })
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return { ok: false, error: DUPLICATE_NAME }
    return internalError('Das Konto konnte nicht gespeichert werden', err)
  }
})
