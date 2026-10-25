export interface CashCountPositionRow {
  id: number
  cash_count_id: number
  register_number: number
  amount_before: number
  amount_after: number
  notes: string | null
}

export interface CashCountPosition extends CashCountPositionRow {
  difference: number
}

export interface CashCountRow {
  id: number
  event_id: number | null
  event_name: string | null
  counted_by_first: number
  counted_by_second: number
  checked_by: number
  counted_before_at: string | null
  counted_after_at: string
}

export interface CashCount extends CashCountRow {
  positions: CashCountPosition[]
}

export interface CashCountOverview {
  id: number
  event_id: number | null
  event_name: string | null
  counted_before_at: string | null
  counted_after_at: string
  counted_by_first_name: string
  counted_by_second_name: string
  checked_by_name: string
  register_count: number
  total_before_amount: number
  total_after_amount: number
  total_difference: number
}

export interface CreateCashCountPositionBody {
  id?: number
  register_number?: number
  amount_before: number
  amount_after: number
  notes: string | null
}

export interface CreateCashCountBody {
  event_id: number | null
  counted_by_first: number
  counted_by_second: number
  checked_by: number
  counted_before_at: string | null
  counted_after_at: string
  positions: CreateCashCountPositionBody[]
}

/** Default sphere/cost centre for cash differences that have no event split (Settings → Cost centres). */
export interface CashDiscrepancyDefaults {
  sphere_id: number | null
  cost_centre_id: number | null
}

export interface CashDiscrepancyBookingRow {
  id: number
  cash_count_id: number
  /** The net difference of the whole count when it was confirmed. */
  amount: number
  sphere_id: number | null
  cost_centre_id: number | null
  notes: string | null
  confirmed_by: number | null
  confirmed_by_name: string | null
  confirmed_at: string
}

export interface SaveCashDiscrepancyBookingBody {
  /** Both null = keep the automatic assignment (event split or default); both set = override. */
  sphere_id: number | null
  cost_centre_id: number | null
  notes: string | null
}
