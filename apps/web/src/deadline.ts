export interface DeadlineParts {
  enabled: boolean;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  timezone: string;
}

export interface ComposedDeadline {
  value?: string | null;
  error?: string;
}

const deadlinePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i;
const timezonePattern = /^(Z|([+-])(\d{2}):(\d{2}))$/i;

const pad = (value: number): string => String(value).padStart(2, "0");

export function formatTimezoneOffset(minutesEastOfUtc: number): string {
  if (minutesEastOfUtc === 0) return "Z";
  const sign = minutesEastOfUtc < 0 ? "-" : "+";
  const absolute = Math.abs(minutesEastOfUtc);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export const TIMEZONE_OPTIONS = Array.from(
  { length: (14 * 60 + 12 * 60) / 15 + 1 },
  (_, index) => formatTimezoneOffset(-12 * 60 + index * 15),
);

function defaults(now: Date): Omit<DeadlineParts, "enabled"> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  return {
    year: String(tomorrow.getFullYear()),
    month: String(tomorrow.getMonth() + 1),
    day: String(tomorrow.getDate()),
    hour: String(tomorrow.getHours()),
    minute: String(tomorrow.getMinutes()),
    timezone: formatTimezoneOffset(-tomorrow.getTimezoneOffset()),
  };
}

export function splitDeadline(
  value: string | null,
  now = new Date(),
  localMinutesEastOfUtc = -new Date().getTimezoneOffset(),
): DeadlineParts {
  if (!value) return { enabled: false, ...defaults(now) };
  const match = deadlinePattern.exec(value);
  if (match && match[6]!.toUpperCase() !== "Z")
    return {
      enabled: true,
      year: String(Number(match[1])),
      month: String(Number(match[2])),
      day: String(Number(match[3])),
      hour: String(Number(match[4])),
      minute: String(Number(match[5])),
      timezone: match[6]!.toUpperCase(),
    };

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    return { enabled: false, ...defaults(now) };
  const local = new Date(parsed.getTime() + localMinutesEastOfUtc * 60 * 1_000);
  return {
    enabled: true,
    year: String(local.getUTCFullYear()),
    month: String(local.getUTCMonth() + 1),
    day: String(local.getUTCDate()),
    hour: String(local.getUTCHours()),
    minute: String(local.getUTCMinutes()),
    timezone: formatTimezoneOffset(localMinutesEastOfUtc),
  };
}

function wholeNumber(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function validTimezone(value: string): boolean {
  const match = timezonePattern.exec(value);
  if (!match) return false;
  if (match[1]!.toUpperCase() === "Z") return true;
  const hours = Number(match[3]);
  const minutes = Number(match[4]);
  if (![0, 15, 30, 45].includes(minutes)) return false;
  const total = hours * 60 + minutes;
  const signed = match[2] === "-" ? -total : total;
  return signed >= -12 * 60 && signed <= 14 * 60;
}

export function composeDeadline(parts: DeadlineParts): ComposedDeadline {
  if (!parts.enabled) return { value: null };
  const year = wholeNumber(parts.year);
  const month = wholeNumber(parts.month);
  const day = wholeNumber(parts.day);
  const hour = wholeNumber(parts.hour);
  const minute = wholeNumber(parts.minute);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  )
    return { error: "请完整填写年月日和时间" };
  if (year < 1_000 || year > 9_999) return { error: "年份需要填写四位数字" };
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    return { error: "日期或时间超出有效范围" };
  const calendarCheck = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  )
    return { error: "这一天在所选月份中不存在" };
  const timezone = parts.timezone.trim().toUpperCase();
  if (!validTimezone(timezone))
    return { error: "请选择或输入有效时区，例如 +08:00" };
  return {
    value: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${timezone}`,
  };
}

export function stepDeadlinePart(
  value: string,
  delta: number,
  minimum: number,
  maximum: number,
): string {
  const parsed = wholeNumber(value);
  const next = Math.min(
    maximum,
    Math.max(minimum, (parsed ?? minimum) + delta),
  );
  return String(next);
}
