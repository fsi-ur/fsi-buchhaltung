import type { PermissionKey } from '~/config/permissions'

export type WikiEmbedArgType = 'number' | 'string' | 'boolean'

export interface WikiEmbedDefinition {
  key: string
  labelKey: string
  /** What the widget shows — the editor's insert helper and syntax reference explain it with this. */
  descriptionKey: string
  /** The reader needs at least one of these; the embed handler re-checks them itself. */
  permissions: PermissionKey[]
  argsSchema?: Record<string, WikiEmbedArgType>
  /** Args the insert helper offers a picker for instead of a bare input. */
  argPickers?: Record<string, 'costCentre'>
}

/**
 * The single source of truth for what an article may embed. The renderer validates every
 * `:::embed{widget="…"}` against this list, the editor builds its insert menu from it, and the
 * resolve endpoint dispatches on it.
 */
export const WIKI_EMBEDS: WikiEmbedDefinition[] = [
  { key: 'open-reimbursements', labelKey: 'wiki.embeds.openReimbursements', descriptionKey: 'wiki.editor.helper.embedInfo.openReimbursements', permissions: ['reimbursements.view'] },
  { key: 'budget-status', labelKey: 'wiki.embeds.budgetStatus', descriptionKey: 'wiki.editor.helper.embedInfo.budgetStatus', permissions: ['budgets.view'], argsSchema: { year: 'number', costCentreId: 'number' }, argPickers: { costCentreId: 'costCentre' } },
  { key: 'cash-position', labelKey: 'wiki.embeds.cashPosition', descriptionKey: 'wiki.editor.helper.embedInfo.cashPosition', permissions: ['cash_counts.view'] },
  { key: 'next-events', labelKey: 'wiki.embeds.nextEvents', descriptionKey: 'wiki.editor.helper.embedInfo.nextEvents', permissions: ['events.access'], argsSchema: { limit: 'number' } },
  { key: 'my-shifts', labelKey: 'wiki.embeds.myShifts', descriptionKey: 'wiki.editor.helper.embedInfo.myShifts', permissions: ['events.access'], argsSchema: { limit: 'number' } },
  { key: 'my-open-tasks', labelKey: 'wiki.embeds.myOpenTasks', descriptionKey: 'wiki.editor.helper.embedInfo.myOpenTasks', permissions: ['events.access'] },
  { key: 'association-contact', labelKey: 'wiki.embeds.associationContact', descriptionKey: 'wiki.editor.helper.embedInfo.associationContact', permissions: ['positions.view'] },
  { key: 'pending-member-changes', labelKey: 'wiki.embeds.pendingMemberChanges', descriptionKey: 'wiki.editor.helper.embedInfo.pendingMemberChanges', permissions: ['members.approveChanges'] },
]

export const WIKI_EMBEDS_BY_KEY: Record<string, WikiEmbedDefinition> = Object.fromEntries(
  WIKI_EMBEDS.map(embed => [embed.key, embed]),
)
