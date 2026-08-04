import {
  calculateAgeDays,
  colorAge,
  formatAge,
  shortRevision,
  styleText,
} from './format.js';
import { fetchHubModel, hubModelUrl } from './hub.js';

const revisionFields = ['sha', 'lastModified'];

export { calculateAgeDays, formatAge };

/**
 * Build the Hub API URL that resolves a model branch or tag to a commit.
 *
 * @param {string} modelId
 * @param {string} track
 * @param {string} [endpoint]
 */
export function modelRevisionUrl(modelId, track, endpoint) {
  return hubModelUrl(modelId, track, revisionFields, endpoint);
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
    timeoutMs,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required to check model revisions.');
  }

  return Promise.all(
    models.map(async (model) => {
      const info = await fetchHubModel(model.id, model.track, {
        fields: revisionFields,
        fetchImpl,
        token,
        timeoutMs,
        action: 'resolve',
      });

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
    latestAt: model.latestAt,
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
  const cellStyles = {
    model: 'cyan',
    current: null,
    track: 'magenta',
    latest: null,
    status: 'amber',
  };
  const widths = Object.fromEntries(
    keys.map((key) => [key, Math.max(headings[key].length, ...rows.map((row) => row[key].length))]),
  );
  const line = (row, styled = false) =>
    [
      ...keys.map((key) => formatCell(row[key], widths[key], styled ? cellStyles[key] : null)),
      row.age,
    ].join('  ');
  const lines = [line(headings)];

  for (const row of rows) {
    const age = color ? colorAge(row.age, row.latestAt, now) : row.age;
    lines.push(
      line({
        ...row,
        age,
      }, color),
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

function formatCell(value, width, style) {
  const padding = ' '.repeat(width - value.length);
  return `${style === null ? value : styleText(value, style)}${padding}`;
}
