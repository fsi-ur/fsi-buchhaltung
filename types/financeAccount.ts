export type FinanceAccountType = 'bank' | 'other'

export interface FinanceAccountRow {
  id: number
  name: string
  account_type: FinanceAccountType
  account_holder: string | null
  iban: string | null
  bic: string | null
  bankname: string | null
  identifier: string | null
  notes: string | null
  is_default: boolean
  archived: boolean
}

/** Account as listed in the settings: plus whether anything books on it (then it cannot be deleted). */
export interface FinanceAccountSettingsRow extends FinanceAccountRow {
  in_use: boolean
}

/** Lean account entry for dropdowns and labels; archived ones are included for historic records. */
export interface FinanceAccountOption {
  id: number
  name: string
  account_type: FinanceAccountType
  iban: string | null
  is_default: boolean
  archived: boolean
}

export interface SaveFinanceAccountBody {
  id?: number
  name: string
  account_type: FinanceAccountType
  account_holder: string | null
  iban: string | null
  bic: string | null
  bankname: string | null
  identifier: string | null
  notes: string | null
  is_default: boolean
  archived: boolean
}

export interface FinanceAccountBalance {
  account_id: number
  name: string
  archived: boolean
  balance: number
}
