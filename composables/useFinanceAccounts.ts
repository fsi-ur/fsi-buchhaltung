import type { FinanceAccountOption } from '~/types/financeAccount'
import type { FinanceAccountOptionsResponse } from '~/server/api/finance_accounts/options.get'

/**
 * The association's own accounts, shared across the app.
 * - `bankEnabled`: an active account exists — only then can new bank records be created or changed.
 * - `bankVisible`: any account exists (archived ones included) — old bank data stays viewable even
 *   after the last account was archived.
 * Loaded once per session; `refresh()` after a change in the settings.
 */
export function useFinanceAccounts() {
  const accounts = useState<FinanceAccountOption[]>('finance-accounts', () => [])
  const bankEnabled = useState<boolean>('finance-accounts-bank-enabled', () => false)
  const loaded = useState<boolean>('finance-accounts-loaded', () => false)
  const pending = useState<Promise<void> | null>('finance-accounts-pending', () => null)

  async function refresh() {
    try {
      const res = await apiFetch<FinanceAccountOptionsResponse>('/api/finance_accounts/options')
      if (res.ok) {
        accounts.value = res.accounts
        bankEnabled.value = res.bankEnabled
      } else {
        accounts.value = []
        bankEnabled.value = false
      }
    } catch {
      // Keep the last known state on a network error.
    } finally {
      loaded.value = true
    }
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve()
    if (!pending.value) pending.value = refresh().finally(() => { pending.value = null })
    return pending.value
  }

  const bankVisible = computed(() => accounts.value.length > 0)
  const activeAccounts = computed(() => accounts.value.filter(account => !account.archived))
  const defaultAccount = computed(() => activeAccounts.value.find(account => account.is_default) ?? null)
  /** Default account, or the only active one — what a new record preselects. */
  const preselectedAccountId = computed(() =>
    defaultAccount.value?.id ?? (activeAccounts.value.length === 1 ? activeAccounts.value[0]!.id : null))

  function accountName(id: number | null | undefined) {
    if (!id) return ''
    return accounts.value.find(account => account.id === id)?.name ?? ''
  }

  /** Active accounts plus the given (possibly archived) ones a record already uses. */
  function selectableAccounts(...keepIds: Array<number | null | undefined>) {
    const keep = new Set(keepIds.filter((id): id is number => Boolean(id)))
    return accounts.value.filter(account => !account.archived || keep.has(account.id))
  }

  if (import.meta.client) void ensureLoaded()

  return {
    accounts,
    activeAccounts,
    defaultAccount,
    preselectedAccountId,
    bankEnabled,
    bankVisible,
    loaded,
    refresh,
    ensureLoaded,
    accountName,
    selectableAccounts,
  }
}
