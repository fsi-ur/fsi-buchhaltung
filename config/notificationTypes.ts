export type NotificationTypeKey =
  // shifts
  | 'shift.assigned'
  | 'shift.removed'
  | 'shift.changed'
  | 'shift.reminder'
  | 'shift.understaffed'
  // tasks
  | 'task.assigned'
  | 'task.deadline_reminder'
  | 'task.overdue'
  // events
  | 'event.created'
  | 'event.changed'
  | 'event.reminder'
  // appointments
  | 'appointment.invited'
  | 'appointment.changed'
  | 'appointment.cancelled'
  | 'appointment.reminder'
  // members
  | 'member.welcome_active'
  | 'member.welcome_passive'
  // admin-composed
  | 'custom.message'

export interface NotificationTypeSchedule {
  /** Minutes before the anchor timestamp; admins override this in global settings. */
  defaultLeadMinutes: number[]
  /** Which timestamp the lead time counts back from. */
  anchor: 'shift.starts_at' | 'task.deadline' | 'event.starts_at' | 'appointment.starts_at'
}

export const SCHEDULE_ANCHOR_VARIABLES: Record<NotificationTypeSchedule['anchor'], string> = {
  'shift.starts_at': 'shift_start',
  'task.deadline': 'task_deadline',
  'event.starts_at': 'event_start',
  'appointment.starts_at': 'appointment_start',
}

export interface NotificationTypeDefinition {
  key: NotificationTypeKey
  categoryKey: string
  labelKey: string
  descriptionKey: string
  /** false => hidden from the user preference matrix and always delivered (custom.message). */
  userConfigurable: boolean
  /** Who it is aimed at — drives the default recipient rule at the call site. Documentation + UI grouping. */
  audience: 'assignees' | 'organizers' | 'explicit'
  /** Present => this is a time-based reminder with admin-configurable lead times. */
  schedule?: NotificationTypeSchedule
  /** Variables usable in the message templates; surfaced as chips in the settings editor. */
  variables: string[]
  /** Deep link for the in-app bell and the e-mail button. */
  link?: (payload: Record<string, any>) => { page: string, meta?: Record<string, any> }
}

const shiftLink = (payload: Record<string, any>) => ({ page: 'EventCreate', meta: { eventId: payload.event_id, tab: 'shifts' } })
const taskLink = (payload: Record<string, any>) => ({ page: 'EventCreate', meta: { eventId: payload.event_id, tab: 'tasks' } })
const eventLink = (payload: Record<string, any>) => ({ page: 'EventCreate', meta: { eventId: payload.event_id } })
const appointmentLink = (payload: Record<string, any>) => ({
  page: 'Calendar',
  meta: { appointmentId: payload.appointment_id, occurrenceDate: payload.occurrence_date },
})

/** Present in every notification's payload regardless of type — safe to offer wherever nothing type-specific is being referenced. */
export const RECIPIENT_VARIABLES = ['member_name', 'first_name', 'association_name']

/**
 * The association's own details plus whoever currently holds a responsible position or an explicit
 * assignment (see `getAssociationResponsibleMemberNames` in server/utils/invoices.ts) — static, so
 * only ever offered where nothing about a specific notification type is being referenced: the e-mail
 * footer, which is appended to every type's e-mail equally.
 */
export const ASSOCIATION_VARIABLES = [
  'association_name', 'association_short_name', 'association_street', 'association_street_number', 'association_postal_code',
  'association_city', 'association_email', 'association_phone', 'association_website', 'association_vat_id',
  'association_iban', 'association_bic', 'association_bankname', 'association_register_number',
  'association_register_court', 'association_responsible_members',
]

export const EMAIL_FOOTER_VARIABLES = [...ASSOCIATION_VARIABLES]

export const NOTIFICATION_TYPES: NotificationTypeDefinition[] = [
  {
    key: 'shift.assigned',
    categoryKey: 'notifications.categories.shifts',
    labelKey: 'notifications.types.shift.assigned.label',
    descriptionKey: 'notifications.types.shift.assigned.description',
    userConfigurable: true,
    audience: 'assignees',
    variables: ['member_name', 'event_name', 'shift_name', 'shift_start', 'shift_end', 'location'],
    link: shiftLink,
  },
  {
    key: 'shift.removed',
    categoryKey: 'notifications.categories.shifts',
    labelKey: 'notifications.types.shift.removed.label',
    descriptionKey: 'notifications.types.shift.removed.description',
    userConfigurable: true,
    audience: 'assignees',
    variables: ['member_name', 'event_name', 'shift_name', 'shift_start', 'shift_end', 'location'],
    link: shiftLink,
  },
  {
    key: 'shift.changed',
    categoryKey: 'notifications.categories.shifts',
    labelKey: 'notifications.types.shift.changed.label',
    descriptionKey: 'notifications.types.shift.changed.description',
    userConfigurable: true,
    audience: 'assignees',
    variables: ['member_name', 'event_name', 'shift_name', 'shift_start', 'shift_end', 'location', 'changes'],
    link: shiftLink,
  },
  {
    key: 'shift.reminder',
    categoryKey: 'notifications.categories.shifts',
    labelKey: 'notifications.types.shift.reminder.label',
    descriptionKey: 'notifications.types.shift.reminder.description',
    userConfigurable: true,
    audience: 'assignees',
    schedule: { defaultLeadMinutes: [1440, 120], anchor: 'shift.starts_at' },
    variables: ['member_name', 'event_name', 'shift_name', 'shift_start', 'shift_end', 'location', 'lead_text'],
    link: shiftLink,
  },
  {
    key: 'shift.understaffed',
    categoryKey: 'notifications.categories.shifts',
    labelKey: 'notifications.types.shift.understaffed.label',
    descriptionKey: 'notifications.types.shift.understaffed.description',
    userConfigurable: true,
    audience: 'organizers',
    schedule: { defaultLeadMinutes: [2880], anchor: 'shift.starts_at' },
    // `assigned_people` is how many signed up, `missing_people` how many are still needed.
    variables: ['event_name', 'shift_name', 'shift_start', 'shift_end', 'location', 'assigned_people', 'missing_people', 'required_people'],
    link: shiftLink,
  },
  {
    key: 'task.assigned',
    categoryKey: 'notifications.categories.tasks',
    labelKey: 'notifications.types.task.assigned.label',
    descriptionKey: 'notifications.types.task.assigned.description',
    userConfigurable: true,
    audience: 'assignees',
    variables: ['member_name', 'event_name', 'task_title', 'task_deadline'],
    link: taskLink,
  },
  {
    key: 'task.deadline_reminder',
    categoryKey: 'notifications.categories.tasks',
    labelKey: 'notifications.types.task.deadline_reminder.label',
    descriptionKey: 'notifications.types.task.deadline_reminder.description',
    userConfigurable: true,
    audience: 'assignees',
    schedule: { defaultLeadMinutes: [2880, 480], anchor: 'task.deadline' },
    variables: ['member_name', 'event_name', 'task_title', 'task_deadline', 'lead_text'],
    link: taskLink,
  },
  {
    key: 'task.overdue',
    categoryKey: 'notifications.categories.tasks',
    labelKey: 'notifications.types.task.overdue.label',
    descriptionKey: 'notifications.types.task.overdue.description',
    userConfigurable: true,
    audience: 'organizers',
    variables: ['event_name', 'task_title', 'task_deadline', 'days_overdue'],
    link: taskLink,
  },
  {
    key: 'event.created',
    categoryKey: 'notifications.categories.events',
    labelKey: 'notifications.types.event.created.label',
    descriptionKey: 'notifications.types.event.created.description',
    userConfigurable: true,
    audience: 'explicit',
    variables: ['event_name', 'event_start', 'event_end', 'location'],
    link: eventLink,
  },
  {
    key: 'event.changed',
    categoryKey: 'notifications.categories.events',
    labelKey: 'notifications.types.event.changed.label',
    descriptionKey: 'notifications.types.event.changed.description',
    userConfigurable: true,
    audience: 'assignees',
    variables: ['event_name', 'event_start', 'event_end', 'location', 'changes'],
    link: eventLink,
  },
  {
    key: 'event.reminder',
    categoryKey: 'notifications.categories.events',
    labelKey: 'notifications.types.event.reminder.label',
    descriptionKey: 'notifications.types.event.reminder.description',
    userConfigurable: true,
    audience: 'assignees',
    schedule: { defaultLeadMinutes: [10080, 1440], anchor: 'event.starts_at' },
    variables: ['event_name', 'event_start', 'event_end', 'location', 'lead_text'],
    link: eventLink,
  },
  {
    key: 'appointment.invited',
    categoryKey: 'notifications.categories.appointments',
    labelKey: 'notifications.types.appointment.invited.label',
    descriptionKey: 'notifications.types.appointment.invited.description',
    userConfigurable: true,
    audience: 'explicit',
    variables: ['member_name', 'appointment_title', 'appointment_type', 'appointment_start', 'appointment_end', 'location'],
    link: appointmentLink,
  },
  {
    key: 'appointment.changed',
    categoryKey: 'notifications.categories.appointments',
    labelKey: 'notifications.types.appointment.changed.label',
    descriptionKey: 'notifications.types.appointment.changed.description',
    userConfigurable: true,
    audience: 'explicit',
    variables: ['member_name', 'appointment_title', 'appointment_type', 'appointment_start', 'appointment_end', 'location', 'changes'],
    link: appointmentLink,
  },
  {
    key: 'appointment.cancelled',
    categoryKey: 'notifications.categories.appointments',
    labelKey: 'notifications.types.appointment.cancelled.label',
    descriptionKey: 'notifications.types.appointment.cancelled.description',
    userConfigurable: true,
    audience: 'explicit',
    variables: ['member_name', 'appointment_title', 'appointment_type', 'appointment_start', 'appointment_end', 'location'],
    link: appointmentLink,
  },
  {
    key: 'appointment.reminder',
    categoryKey: 'notifications.categories.appointments',
    labelKey: 'notifications.types.appointment.reminder.label',
    descriptionKey: 'notifications.types.appointment.reminder.description',
    userConfigurable: true,
    audience: 'explicit',
    schedule: { defaultLeadMinutes: [1440, 120], anchor: 'appointment.starts_at' },
    variables: ['member_name', 'appointment_title', 'appointment_type', 'appointment_start', 'appointment_end', 'location', 'lead_text'],
    link: appointmentLink,
  },
  {
    key: 'member.welcome_active',
    categoryKey: 'notifications.categories.members',
    labelKey: 'notifications.types.member.welcome_active.label',
    descriptionKey: 'notifications.types.member.welcome_active.description',
    userConfigurable: false,
    audience: 'explicit',
    variables: ['member_name', 'first_name', 'member_email', 'joined_at', 'subject_name', 'association_name'],
  },
  {
    key: 'member.welcome_passive',
    categoryKey: 'notifications.categories.members',
    labelKey: 'notifications.types.member.welcome_passive.label',
    descriptionKey: 'notifications.types.member.welcome_passive.description',
    userConfigurable: false,
    audience: 'explicit',
    variables: ['member_name', 'first_name', 'member_email', 'joined_at', 'subject_name', 'association_name'],
  },
  {
    key: 'custom.message',
    categoryKey: 'notifications.categories.custom',
    labelKey: 'notifications.types.custom.message.label',
    descriptionKey: 'notifications.types.custom.message.description',
    userConfigurable: false,
    audience: 'explicit',
    variables: RECIPIENT_VARIABLES,
  },
]

export const NOTIFICATION_TYPE_MAP: Record<NotificationTypeKey, NotificationTypeDefinition> = Object.fromEntries(
  NOTIFICATION_TYPES.map(type => [type.key, type]),
) as Record<NotificationTypeKey, NotificationTypeDefinition>

/**
 * Types that are *not* delivered to the user who triggered them: signing yourself up for a shift or
 * a task, or taking yourself off one, needs no notification telling you what you just did. Everyone
 * else on the same shift still receives theirs.
 */
/**
 * The welcome mail per member status. Which one goes out is decided when it is scheduled, and
 * re-decided if the status still changes before it is sent (see server/utils/memberWelcome.ts).
 */
export const MEMBER_WELCOME_TYPES = {
  active: 'member.welcome_active',
  passive: 'member.welcome_passive',
} as const satisfies Record<string, NotificationTypeKey>

export const MEMBER_WELCOME_TYPE_KEYS: NotificationTypeKey[] = Object.values(MEMBER_WELCOME_TYPES)

export const SELF_ACTION_EXEMPT_TYPES: NotificationTypeKey[] = ['shift.assigned', 'shift.removed', 'task.assigned']
