import { calculateAgeDays, colorAge, formatAge, styleText } from './format.js';
import { fetchHubModel, hubModelUrl } from './hub.js';

const infoFields = [
  'cardData',
  'gated',
  'lastModified',
  'library_name',
  'pipeline_tag',
  'private',
  'sha',
  'tags',
];

/**
 * Build the Hub API URL for model metadata at a branch or tag.
 *
 * @param {string} modelId
 * @param {string} track
 * @param {string} [endpoint]
 */
export function modelInfoUrl(modelId, track, endpoint) {
  return hubModelUrl(modelId, track, infoFields, endpoint);
}

/**
 * Retrieve useful Hub metadata and compare it with an optional pinned revision.
 *
 * @param {{ name?: string, id: string, revision?: string, track?: string }} model
 * @param {{ fetchImpl?: typeof fetch, token?: string, timeoutMs?: number }} [options]
 */
export async function getModelInfo(
  model,
  {
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    timeoutMs,
  } = {},
) {
  const track = model.track ?? 'main';
  const info = await fetchHubModel(model.id, track, {
    fields: infoFields,
    fetchImpl,
    token,
    timeoutMs,
  });

  const task = optionalString(info.pipeline_tag);
  const library = optionalString(info.library_name);
  const license = formatLicense(info.cardData?.license);

  return {
    name: model.name,
    id: model.id,
    revision: model.revision,
    track,
    latestRevision: info.sha,
    latestAt: info.lastModified,
    outdated: model.revision === undefined ? null : model.revision !== info.sha,
    task,
    library,
    license,
    tags: formatTags(info.tags, { task, library, license }),
    private: typeof info.private === 'boolean' ? info.private : null,
    gated: normalizeGated(info.gated),
  };
}

/**
 * Format model information for a terminal.
 *
 * @param {Awaited<ReturnType<typeof getModelInfo>>} model
 * @param {{ color?: boolean, now?: number }} [options]
 */
export function formatModelInfo(model, { color = false, now = Date.now() } = {}) {
  const paint = (value, ...styles) => color ? styleText(value, ...styles) : value;
  const separator = paint(' | ', 'dim');
  const summary = [
    paint(model.id, 'bold', 'cyan'),
    model.task === null ? null : paint(model.task, 'cyan'),
    model.library === null ? null : paint(model.library, 'cyan'),
  ].filter(Boolean).join(separator);
  const age = formatAge(model.latestAt, now);
  const displayedAge = color && model.outdated === true
    ? colorAge(age, model.latestAt, now)
    : age;
  const exactTimestamp = paint(model.latestAt, 'dim');
  const lines = [
    summary,
    paint(`https://huggingface.co/${model.id}`, 'blue', 'underline'),
    '',
  ];

  if (model.revision !== undefined) lines.push(`Current:  ${model.revision}`);
  lines.push(`Track:    ${paint(model.track, 'magenta')}`);
  lines.push(`Latest:   ${model.latestRevision}`);
  if (model.outdated !== null) {
    const status = model.outdated ? 'outdated' : 'current';
    lines.push(`Status:   ${paint(status, model.outdated ? 'amber' : 'green')}`);
  }
  lines.push(`Updated:  ${displayedAge} (${exactTimestamp})`);

  const metadata = [
    ['License', model.license === null ? null : paint(model.license, 'green')],
    ['Tags', model.tags.length > 0 ? paint(model.tags.join(', '), 'cyan') : null],
    ['Access', formatColoredAccess(model, paint)],
  ].filter(([, value]) => value !== null);

  if (metadata.length > 0) {
    lines.push('');
    for (const [label, value] of metadata) lines.push(`${label}: ${value}`);
  }

  return lines.join('\n');
}

/**
 * Format model information as stable, uncolored JSON for scripts.
 *
 * @param {Awaited<ReturnType<typeof getModelInfo>>} model
 * @param {{ now?: number }} [options]
 */
export function formatModelInfoJson(model, { now = Date.now() } = {}) {
  return JSON.stringify(
    {
      model: model.id,
      url: `https://huggingface.co/${model.id}`,
      current: model.revision ?? null,
      track: model.track,
      latest: model.latestRevision,
      status: model.outdated === null ? 'untracked' : model.outdated ? 'outdated' : 'current',
      latestAt: model.latestAt,
      ageDays: calculateAgeDays(model.latestAt, now),
      task: model.task,
      library: model.library,
      license: model.license,
      tags: model.tags,
      private: model.private,
      gated: model.gated,
    },
    null,
    2,
  );
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function formatLicense(value) {
  if (Array.isArray(value)) {
    const licenses = value.filter((item) => typeof item === 'string' && item.trim() !== '');
    return licenses.length > 0 ? licenses.join(', ') : null;
  }
  return optionalString(value);
}

function formatTags(value, { task, library, license }) {
  if (!Array.isArray(value)) return [];
  const repeatedTags = new Set(
    [task, library, license === null ? null : `license:${license}`]
      .filter(Boolean)
      .map((tag) => tag.toLowerCase()),
  );

  return value.filter((tag) =>
    typeof tag === 'string'
    && tag.trim() !== ''
    && !tag.includes(':')
    && !repeatedTags.has(tag.toLowerCase()));
}

function normalizeGated(value) {
  if (value === false || value === 'auto' || value === 'manual') return value;
  if (value === true) return true;
  return null;
}

function formatAccess(model) {
  if (model.private === true) return 'private';
  if (model.gated === true) return 'gated';
  if (typeof model.gated === 'string') return `gated (${model.gated})`;
  if (model.private === false && model.gated === false) return 'public';
  return null;
}

function formatColoredAccess(model, paint) {
  const access = formatAccess(model);
  if (access === null) return null;
  const style = model.private === true
    ? 'red'
    : model.gated === true || typeof model.gated === 'string'
      ? 'amber'
      : 'green';
  return paint(access, style);
}
