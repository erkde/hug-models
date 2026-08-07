const DAY_MS = 24 * 60 * 60 * 1_000;
const ansi = {
  amber: '\u001b[33m',
  blue: '\u001b[34m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  magenta: '\u001b[35m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
  underline: '\u001b[4m',
};

/**
 * Format a Hub timestamp as a compact relative age.
 *
 * @param {string | undefined} lastModified
 * @param {number} [now]
 */
export function formatAge(lastModified, now = Date.now()) {
  const ageMs = ageMilliseconds(lastModified, now);
  if (ageMs === null) return 'unknown';

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${plural('minute', minutes)} ago`;

  const hours = Math.floor(ageMs / (60 * 60_000));
  if (hours < 24) return `${hours} ${plural('hour', hours)} ago`;

  const days = Math.floor(ageMs / DAY_MS);
  if (days < 30) return `${days} ${plural('day', days)} ago`;

  const months = Math.floor(days / 30);
  if (days < 365) return `${months} ${plural('month', months)} ago`;

  const years = Math.floor(days / 365);
  return `${years} ${plural('year', years)} ago`;
}

/**
 * Calculate the whole number of days since a Hub timestamp.
 *
 * @param {string | undefined} lastModified
 * @param {number} [now]
 */
export function calculateAgeDays(lastModified, now = Date.now()) {
  const ageMs = ageMilliseconds(lastModified, now);
  return ageMs === null ? null : Math.floor(ageMs / DAY_MS);
}

/**
 * Color a formatted age according to the standard freshness thresholds.
 *
 * @param {string} age
 * @param {string | undefined} lastModified
 * @param {number} [now]
 */
export function colorAge(age, lastModified, now = Date.now()) {
  const ageMs = ageMilliseconds(lastModified, now);
  if (ageMs === null) return age;
  const color = ageMs < 30 * DAY_MS ? 'green' : ageMs < 90 * DAY_MS ? 'amber' : 'red';
  return styleText(age, color);
}

/**
 * Apply one or more terminal styles to text.
 *
 * @param {string} value
 * @param {...keyof typeof ansi} styles
 */
export function styleText(value, ...styles) {
  return `${styles.map((style) => ansi[style]).join('')}${value}${ansi.reset}`;
}

function ageMilliseconds(lastModified, now) {
  const timestamp = Date.parse(lastModified ?? '');
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

function plural(noun, count) {
  return count === 1 ? noun : `${noun}s`;
}
