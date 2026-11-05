import { defineEventHandler, readBody } from 'h3'
import type mariadb from 'mariadb'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import type { BudgetSemester, SaveBudgetBody, SaveBudgetLineBody } from '~/types/budget'
import { internalError } from '~/server/utils/api/errors'

interface SaveBudgetSuccess {
  ok: true
  id: number
}

interface SaveBudgetError {
  ok: false
  error: string
}

type SaveBudgetResponse = SaveBudgetSuccess | SaveBudgetError

interface MysqlError extends Error {
  code?: string
}

interface BudgetRow {
  id: number
  start_date: string
  end_date: string
  notes: string | null
}

interface BudgetLineRow {
  id: number
  budget_id: number
  cost_centre_id: number
  expense_amount: number
  income_amount: number
  notes: string | null
}

function isSemester(value: unknown): value is BudgetSemester {
  return value === 'summer' || value === 'winter'
}

function normalizeAmount(value: unknown) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || Number.isNaN(numeric) || !Number.isFinite(numeric) || numeric < 0) {
    return null
  }

  return Number(numeric.toFixed(2))
}

function normalizeYear(value: unknown) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 2000 || numeric > 2100) return null
  return numeric
}

function getPeriodBounds(year: number, semester: BudgetSemester) {
  if (semester === 'summer') {
    return {
      startDate: `${year}-04-01`,
      endDate: `${year}-09-30`,
    }
  }

  return {
    startDate: `${year}-10-01`,
    endDate: `${year + 1}-03-31`,
  }
}

function normalizeNotes(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function amountEquals(left: unknown, right: unknown) {
  return Number(left ?? 0).toFixed(2) === Number(right ?? 0).toFixed(2)
}

function amountToLogValue(value: unknown) {
  return Number(value ?? 0).toFixed(2)
}

async function loadValidCostCentreIds(conn: mariadb.PoolConnection) {
  const rows = await query<{ id: number }[]>(`SELECT id FROM cost_centres`, [], conn)
  return new Set(rows.map(row => Number(row.id)))
}

function sanitizeLines(lines: unknown, validCostCentreIds: Set<number>) {
  if (!Array.isArray(lines)) return { ok: false as const, error: 'Invalid budget lines' }

  const normalized = new Map<number, SaveBudgetLineBody>()

  for (const rawLine of lines) {
    if (!rawLine || typeof rawLine !== 'object') return { ok: false as const, error: 'Invalid budget lines' }

    const line = rawLine as Partial<SaveBudgetLineBody>
    const costCentreId = Number(line.cost_centre_id)
    const expenseAmount = normalizeAmount(line.expense_amount)
    const incomeAmount = normalizeAmount(line.income_amount)
    const notes = typeof line.notes === 'string' ? line.notes.trim() : ''

    if (!Number.isInteger(costCentreId) || costCentreId <= 0 || !validCostCentreIds.has(costCentreId)) {
      return { ok: false as const, error: 'At least one selected cost centre does not exist' }
    }

    if (expenseAmount === null || incomeAmount === null) {
      return { ok: false as const, error: 'Each budget line requires valid expense and income amounts' }
    }

    if (expenseAmount === 0 && incomeAmount === 0 && !notes) continue

    normalized.set(costCentreId, {
      cost_centre_id: costCentreId,
      expense_amount: expenseAmount,
      income_amount: incomeAmount,
      notes: notes || null,
    })
  }

  return { ok: true as const, lines: Array.from(normalized.values()) }
}

export default defineEventHandler(async (event): Promise<SaveBudgetResponse> => {
  const current = await requirePermission(event, 'budgets.edit', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SaveBudgetBody>(event)
  const year = normalizeYear(body.year)
  const semester = isSemester(body.semester) ? body.semester : null
  const budgetId = body.id !== undefined ? Number(body.id) : null
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  if (year === null || !semester) return { ok: false, error: 'Invalid period' }
  if (budgetId !== null && (!Number.isInteger(budgetId) || budgetId <= 0)) return { ok: false, error: 'Invalid budget id' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const validCostCentreIds = await loadValidCostCentreIds(conn)
      const normalizedLinesResult = sanitizeLines(body.lines, validCostCentreIds)
      if (!normalizedLinesResult.ok) return normalizedLinesResult

      const { startDate, endDate } = getPeriodBounds(year, semester)

      if (budgetId !== null) {
        const existingRows = await query<BudgetRow[]>(
          `SELECT id, start_date, end_date, notes FROM budgets WHERE id = ? LIMIT 1`,
          [budgetId],
          conn,
        )

        if (!existingRows.length) return { ok: false, error: 'Budget not found' }

        const existingLineRows = await query<BudgetLineRow[]>(
          `SELECT id, budget_id, cost_centre_id, expense_amount, income_amount, notes
           FROM budget_cost_centre_lines
           WHERE budget_id = ?`,
          [budgetId],
          conn,
        )

        const existingLinesByCostCentre = new Map(
          existingLineRows.map(line => [Number(line.cost_centre_id), line]),
        )
        const incomingLinesByCostCentre = new Map(
          normalizedLinesResult.lines.map(line => [Number(line.cost_centre_id), line]),
        )

        await query(
          `UPDATE budgets
           SET start_date = ?, end_date = ?, notes = ?
           WHERE id = ?`,
          [startDate, endDate, notes || null, budgetId],
          conn,
        )

        for (const existingLine of existingLineRows) {
          const incomingLine = incomingLinesByCostCentre.get(Number(existingLine.cost_centre_id))

          if (!incomingLine) {
            await query(
              `DELETE FROM budget_cost_centre_lines
               WHERE id = ?`,
              [existingLine.id],
              conn,
            )
            continue
          }

          await query(
            `UPDATE budget_cost_centre_lines
             SET expense_amount = ?, income_amount = ?, notes = ?
             WHERE id = ?`,
            [
              incomingLine.expense_amount,
              incomingLine.income_amount,
              incomingLine.notes ?? null,
              existingLine.id,
            ],
            conn,
          )
        }

        for (const line of normalizedLinesResult.lines) {
          if (existingLinesByCostCentre.has(Number(line.cost_centre_id))) continue

          await query(
            `INSERT INTO budget_cost_centre_lines (
              budget_id,
              cost_centre_id,
              expense_amount,
              income_amount,
              notes
            ) VALUES (?, ?, ?, ?, ?)`,
            [budgetId, line.cost_centre_id, line.expense_amount, line.income_amount, line.notes ?? null],
            conn,
          )
        }

        return { ok: true, id: budgetId }
      }

      const insertResult = await query(
        `INSERT INTO budgets (start_date, end_date, notes)
         VALUES (?, ?, ?)`,
        [startDate, endDate, notes || null],
        conn,
      )

      const createdBudgetId = Number(insertResult.insertId)

      for (const line of normalizedLinesResult.lines) {
        await query(
          `INSERT INTO budget_cost_centre_lines (
            budget_id,
            cost_centre_id,
            expense_amount,
            income_amount,
            notes
          ) VALUES (?, ?, ?, ?, ?)`,
          [createdBudgetId, line.cost_centre_id, line.expense_amount, line.income_amount, line.notes ?? null],
          conn,
        )
      }

      return { ok: true, id: createdBudgetId }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    if (error.code === 'ER_DUP_ENTRY') {
      return { ok: false, error: 'A budget already exists for the selected period' }
    }

    return internalError('Failed to save budget', err)
  }
})
