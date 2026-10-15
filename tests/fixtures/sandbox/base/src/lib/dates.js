'use strict';
// Days are 'YYYY-MM-DD' strings, timestamps full ISO strings; all date math is in UTC.
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day in 'YYYY-MM-DD' form (rejects 2026-02-30).
function isDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

// Whole calendar days from a to b; negative when b is earlier.
function daysBetween(a, b) {
  return Math.round((Date.parse(`${toDay(b)}T00:00:00Z`) - Date.parse(`${toDay(a)}T00:00:00Z`)) / DAY_MS);
}

function addDays(day, n) {
  return toDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
}

// 0 = Sunday ... 6 = Saturday.
function weekday(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

module.exports = { DAY_MS, isDay, toDay, daysBetween, addDays, weekday };
