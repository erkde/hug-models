const DEFAULT_ENDPOINT = 'https://huggingface.co';
const DEFAULT_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const revisionPattern = /^[a-f\d]{40}$/i;
const ansi = {
  amber: '\u001b[33m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
};

/**
 * Build the Hub API URL that resolves a model branch or tag to a commit.
 *
 * @param {string} modelId
 * @param {string} track
 * @param {string} [endpoint]
 */
export function modelRevisionUrl(modelId, track, endpoint = DEFAULT_ENDPOINT) {
  const encodedId = modelId.split('/').map(encodeURIComponent).join('/');
  return `${endpoint}/api/models/${encodedId}/revision/${encodeURIComponent(track)}?expand[]=sha&expand[]=lastModified`;
}

/**
 * Resolve the tracked revision for each model and compare it with its pin.
 *
 * @param {Array<{ name?: string, id: string, revision: string, track: string }>} models
 * @param {{ fetchImpl?: typeof fetch, token?: string, timeoutMs?: number }} [options]
 */
export async function checkOutdatedModels(
  models,
  {
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required to check model revisions.');
  }

  return Promise.all(
    models.map(async (model) => {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetchImpl(modelRevisionUrl(model.id, model.track), {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const status = `${response.status} ${response.statusText ?? ''}`.trim();
        throw new Error(
          `Could not resolve ${model.id}@${model.track}: Hugging Face returned ${status}.`,
        );
      }

      const info = await response.json();
      if (!revisionPattern.test(info.sha ?? '')) {
        throw new Error(`Could not resolve ${model.id}@${model.track}: invalid revision response.`);
      }
      if (Number.isNaN(Date.parse(info.lastModified ?? ''))) {
        throw new Error(
          `Could not resolve ${model.id}@${model.track}: invalid lastModified response.`,
        );
      }

      return {
        ...model,
        latestRevision: info.sha,
        latestAt: info.lastModified,
        outdated: model.revision !== info.sha,
      };
    }),
  );
}

/**
 * Format the result of checkOutdatedModels for a terminal.
 *
 * @param {Awaited<ReturnType<typeof checkOutdatedModels>>} results
 * @param {{ color?: boolean, now?: number }} [options]
 */
export function formatOutdatedModels(results, { color = false, now = Date.now() } = {}) {
  const outdated = results.filter((model) => model.outdated);
  if (outdated.length === 0) return '';

  const rows = outdated.map((model) => ({
    model: model.id,
    current: shortRevision(model.revision),
    track: model.track,
    latest: shortRevision(model.latestRevision),
    status: 'outdated',
    age: formatAge(model.latestAt, now),
    ageMs: ageMilliseconds(model.latestAt, now),
  }));
  const headings = {
    model: 'Model',
    current: 'Current',
    track: 'Track',
    latest: 'Latest',
    status: 'Status',
    age: 'Age',
  };
  const keys = ['model', 'current', 'track', 'latest', 'status'];
  const widths = Object.fromEntries(
    keys.map((key) => [key, Math.max(headings[key].length, ...rows.map((row) => row[key].length))]),
  );
  const line = (row) =>
    [
      ...keys.map((key) => row[key].padEnd(widths[key])),
      row.age,
    ].join('  ');
  const lines = [line(headings)];

  for (const row of rows) {
    const age = color ? colorAge(row.age, row.ageMs) : row.age;
    lines.push(
      line({
        ...row,
        age,
      }),
    );
  }

  return lines.join('\n');
}

/**
 * Format outdated models as stable, uncolored JSON for scripts.
 *
 * @param {Awaited<ReturnType<typeof checkOutdatedModels>>} results
 * @param {{ now?: number }} [options]
 */
export function formatOutdatedModelsJson(results, { now = Date.now() } = {}) {
  return JSON.stringify(
    results
      .filter((model) => model.outdated)
      .map((model) => ({
        model: model.id,
        current: model.revision,
        track: model.track,
        latest: model.latestRevision,
        status: 'outdated',
        latestAt: model.latestAt,
        ageDays: calculateAgeDays(model.latestAt, now),
      })),
    null,
    2,
  );
}

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

function ageMilliseconds(lastModified, now) {
  const timestamp = Date.parse(lastModified ?? '');
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

function colorAge(age, ageMs) {
  if (ageMs === null) return age;
  const color = ageMs < 30 * DAY_MS ? ansi.green : ageMs < 90 * DAY_MS ? ansi.amber : ansi.red;
  return `${color}${age}${ansi.reset}`;
}

function plural(noun, count) {
  return count === 1 ? noun : `${noun}s`;
}

function shortRevision(revision) {
  return revision.slice(0, 7);
}
