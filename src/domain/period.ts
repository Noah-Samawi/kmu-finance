import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

// Alle Tages-/Monatsgrenzen gelten in deutscher Zeit, nicht in UTC.
export const TZ = "Europe/Berlin";

/** "2026-10-06" -> [00:00 Berlin, 00:00 Folgetag Berlin) als UTC-Date */
export function dayRange(day: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Datum im Format JJJJ-MM-TT erwartet");
  const start = fromZonedTime(`${day}T00:00:00`, TZ);
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, TZ);
  return { start, end };
}

/** "2026-10" -> [1. Okt 00:00 Berlin, 1. Nov 00:00 Berlin) */
export function monthRange(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Monat im Format JJJJ-MM erwartet");
  const [y, m] = month.split("-").map(Number);
  const start = fromZonedTime(`${month}-01T00:00:00`, TZ);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = fromZonedTime(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00`, TZ);
  return { start, end };
}

export const todayKey = (now = new Date()) => formatInTimeZone(now, TZ, "yyyy-MM-dd");
export const monthKey = (now = new Date()) => formatInTimeZone(now, TZ, "yyyy-MM");
export const fmtDate = (d: Date | null | undefined) => (d ? formatInTimeZone(d, TZ, "dd.MM.yyyy") : "–");
export const fmtDateTime = (d: Date | null | undefined) => (d ? formatInTimeZone(d, TZ, "dd.MM.yyyy HH:mm") : "–");
export const zoned = (d: Date) => toZonedTime(d, TZ);

/** Kalendertag-Eingabe "2026-10-06" als 12:00 Berlin speichern (robust gegen TZ-Verschiebung) */
export function dateInputToDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Datum im Format JJJJ-MM-TT erwartet");
  return fromZonedTime(`${day}T12:00:00`, TZ);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}
