import { localDateTimeToInstant, normalizeLocalDateTime } from '~/shared/time'

const CRLF = '\r\n'

export interface IcsFeedEvent {
  id: number
  name: string
  starts_at: string
  ends_at: string
  location: string | null
  description: string
}

export interface IcsFeedShift {
  id: number
  eventName: string
  name: string
  description: string
  location: string | null
  starts_at: string
  ends_at: string
}

export interface IcsFeedAppointment {
  appointmentId: number
  occurrenceDate: string
  title: string
  starts_at: string
  ends_at: string
  allDay: boolean
  location: string | null
  description: string
}

export interface IcsFeedTaskDeadline {
  id: number
  eventName: string
  title: string
  deadline: string
  description: string
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

// RFC 5545 line folding: no content line may exceed 75 octets; continuation
// lines start with a single space. Most calendar apps tolerate long lines,
// but Outlook does not, so this is not optional.
function foldLine(line: string): string {
  const maxBytes = 75
  let result = ''
  let chunkBytes = 0
  let isFirstChunk = true

  for (const char of line) {
    const charBytes = Buffer.byteLength(char, 'utf8')
    const limit = isFirstChunk ? maxBytes : maxBytes - 1

    if (chunkBytes + charBytes > limit) {
      result += `${CRLF} `
      chunkBytes = 0
      isFirstChunk = false
    }

    result += char
    chunkBytes += charBytes
  }

  return result
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatUtcTimestamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function formatLocalDateTime(value: string, timeZone: string): string {
  const normalized = normalizeLocalDateTime(String(value).trim().slice(0, 19))
  if (!normalized) return ''
  return formatUtcTimestamp(localDateTimeToInstant(normalized, timeZone))
}

function formatAllDayDate(value: string): string {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''

  const [, year, month, day] = match
  return `${year}${month}${day}`
}

/** An all-day VEVENT's DTEND is exclusive: a one-day appointment ends on the following date. */
function nextDay(value: string): string {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

/** '2026-01-06 18:00:00' → '20260106T180000', for use inside a UID. */
function compactTimestamp(value: string): string {
  return String(value).replace(/[-: ]/g, '').replace(/T/i, '').slice(0, 15)
}

export interface BuildIcsFeedArgs {
  events: IcsFeedEvent[]
  shifts: IcsFeedShift[]
  tasks: IcsFeedTaskDeadline[]
  appointments: IcsFeedAppointment[]
  calendarName: string
  host: string
  /** The app time zone every DATETIME in the feed is meant in. */
  timeZone: string
}

export function buildIcsFeed({
  events,
  shifts,
  tasks,
  appointments,
  calendarName,
  host,
  timeZone,
}: BuildIcsFeedArgs): string {
  const dtstamp = formatUtcTimestamp(new Date())
  const lines: string[] = []

  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//FSi Portal//Calendar Feed//DE')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push(`X-WR-CALNAME:${escapeIcsText(calendarName)}`)
  lines.push(`X-WR-TIMEZONE:${timeZone}`)
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT1H')
  lines.push('X-PUBLISHED-TTL:PT1H')

  for (const evt of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:event-${evt.id}@${host}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${formatLocalDateTime(evt.starts_at, timeZone)}`)
    lines.push(`DTEND:${formatLocalDateTime(evt.ends_at, timeZone)}`)
    lines.push(`SUMMARY:${escapeIcsText(evt.name)}`)
    if (evt.location) lines.push(`LOCATION:${escapeIcsText(evt.location)}`)
    if (evt.description) lines.push(`DESCRIPTION:${escapeIcsText(evt.description)}`)
    lines.push('END:VEVENT')
  }

  for (const shift of shifts) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:shift-${shift.id}@${host}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${formatLocalDateTime(shift.starts_at, timeZone)}`)
    lines.push(`DTEND:${formatLocalDateTime(shift.ends_at, timeZone)}`)
    lines.push(`SUMMARY:${escapeIcsText(`Schicht: ${shift.name} (${shift.eventName})`)}`)
    if (shift.location) lines.push(`LOCATION:${escapeIcsText(shift.location)}`)
    if (shift.description) lines.push(`DESCRIPTION:${escapeIcsText(shift.description)}`)
    lines.push('END:VEVENT')
  }

  for (const task of tasks) {
    const hasTime = task.deadline.length > 10

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:task-${task.id}@${host}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    if (hasTime) {
      lines.push(`DTSTART:${formatLocalDateTime(task.deadline, timeZone)}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${formatAllDayDate(task.deadline)}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(`Frist: ${task.title} (${task.eventName})`)}`)
    if (task.description) lines.push(`DESCRIPTION:${escapeIcsText(task.description)}`)
    lines.push('END:VEVENT')
  }

  for (const appointment of appointments) {
    lines.push('BEGIN:VEVENT')
    // Stable per occurrence — without this every refresh would duplicate the entry in the
    // subscriber's calendar instead of updating it.
    lines.push(`UID:appointment-${appointment.appointmentId}-${compactTimestamp(appointment.occurrenceDate)}@${host}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    if (appointment.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatAllDayDate(appointment.starts_at)}`)
      lines.push(`DTEND;VALUE=DATE:${nextDay(appointment.ends_at)}`)
    } else {
      lines.push(`DTSTART:${formatLocalDateTime(appointment.starts_at, timeZone)}`)
      lines.push(`DTEND:${formatLocalDateTime(appointment.ends_at, timeZone)}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(appointment.title)}`)
    if (appointment.location) lines.push(`LOCATION:${escapeIcsText(appointment.location)}`)
    if (appointment.description) lines.push(`DESCRIPTION:${escapeIcsText(appointment.description)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  return lines.map(foldLine).join(CRLF) + CRLF
}
