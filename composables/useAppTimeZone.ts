import {
  DEFAULT_APP_TIME_ZONE,
  addDaysToLocalDate,
  instantToLocalDate,
  instantToLocalDateTime,
  localDateTimeToInstant,
  nowLocalDateTime,
  startOfLocalDate,
  todayLocalDate,
  type Instant,
  type LocalDate,
  type LocalDateTime,
} from '~/shared/time'

export function useAppTimeZone() {
  const timeZone = useState<string>('app_time_zone', () => DEFAULT_APP_TIME_ZONE)

  return {
    timeZone: readonly(timeZone),
    setTimeZone(value: string) { timeZone.value = value },
    /** Current wall clock in the app time zone, "YYYY-MM-DD HH:mm:ss". */
    nowLocal: (): LocalDateTime => nowLocalDateTime(timeZone.value),
    /** Today in the app time zone, "YYYY-MM-DD". */
    today: (): LocalDate => todayLocalDate(timeZone.value),
    tomorrow: (): LocalDate => addDaysToLocalDate(todayLocalDate(timeZone.value), 1),
    toLocalDateTime: (instant: Date | Instant): LocalDateTime => instantToLocalDateTime(instant, timeZone.value),
    toLocalDate: (instant: Date | Instant): LocalDate => instantToLocalDate(instant, timeZone.value),
    toInstant: (value: LocalDateTime): Date => localDateTimeToInstant(value, timeZone.value),
    startOfDay: (value: LocalDate): Date => startOfLocalDate(value, timeZone.value),
  }
}
