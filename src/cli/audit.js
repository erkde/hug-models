import { styleText } from './format.js';
import { fetchHubModelSecurity, hubModelSecurityUrl } from './hub.js';

const fullRevisionPattern = /^[a-f\d]{40}$/i;
const issueLevels = new Set(['caution', 'unsafe']);

/**
 * Build the Hub API URL that retrieves security status for a pinned revision.
 *
 * @param {string} modelId
 * @param {string} revision
 * @param {string} [endpoint]
 */
export function modelAuditUrl(modelId, revision, endpoint) {
  return hubModelSecurityUrl(modelId, revision, endpoint);
}

/**
 * Retrieve Hub security scan results for each pinned model revision.
 *
 * @param {Array<{ name?: string, id: string, revision: string }>} models
 * @param {{ fetchImpl?: typeof fetch, token?: string, timeoutMs?: number }} [options]
 */
export async function auditModels(
  models,
  {
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    timeoutMs,
  } = {},
) {
  return Promise.all(
    models.map(async (model) => {
      const info = await fetchHubModelSecurity(model.id, model.revision, {
        fetchImpl,
        token,
        timeoutMs,
      });

      if (
        fullRevisionPattern.test(model.revision)
        && info.sha.toLowerCase() !== model.revision.toLowerCase()
      ) {
        throw new Error(
          `Could not audit ${model.id}@${model.revision}: Hub response resolved to ${info.sha}.`,
        );
      }

      const security = normalizeSecurityStatus(info.securityRepoStatus, model);
      return {
        ...model,
        scannedRevision: info.sha,
        ...security,
        status: auditStatus(security),
      };
    }),
  );
}

/**
 * Format model audit results for a terminal.
 *
 * @param {Awaited<ReturnType<typeof auditModels>>} results
 * @param {{ color?: boolean }} [options]
 */
export function formatAuditResults(results, { color = false } = {}) {
  const paint = (value, ...styles) => color ? styleText(value, ...styles) : value;
  if (results.every((model) => model.status === 'clean')) {
    return `found ${paint('0', 'green')} security issues`;
  }

  const sections = [];
  for (const model of results) {
    if (model.issues.length === 0 && model.scansDone) continue;

    const lines = [
      paint(model.id, 'bold', 'cyan'),
      `Revision: ${model.scannedRevision}`,
      `Details: ${paint(modelRevisionUrl(model), 'blue', 'underline')}`,
    ];

    for (const issue of model.issues) {
      lines.push(
        '',
        `File: ${paint(issue.path, 'cyan')}`,
        `Severity: ${paint(issue.level, issue.level === 'unsafe' ? 'red' : 'amber')}`,
      );
    }
    if (!model.scansDone) {
      lines.push(
        '',
        paint('Hub reports that not all scans are done.', 'amber'),
      );
    }
    sections.push(lines.join('\n'));
  }

  return [
    paint('# hug-models audit report', 'bold'),
    '',
    sections.join('\n\n'),
    '',
    formatAuditSummary(results, paint),
  ].join('\n');
}

/**
 * Format model audit results as stable, uncolored JSON.
 *
 * @param {Awaited<ReturnType<typeof auditModels>>} results
 */
export function formatAuditResultsJson(results) {
  return JSON.stringify(
    results.map((model) => ({
      model: model.id,
      revision: model.revision,
      scannedRevision: model.scannedRevision,
      status: model.status,
      scansDone: model.scansDone,
      issues: model.issues,
    })),
    null,
    2,
  );
}

/**
 * Return whether an audit should fail CI.
 *
 * @param {Awaited<ReturnType<typeof auditModels>>} results
 */
export function hasAuditProblems(results) {
  return results.some((model) => model.status !== 'clean');
}

function normalizeSecurityStatus(value, model) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidSecurityResponse(model);
  }
  if (typeof value.scansDone !== 'boolean' || !Array.isArray(value.filesWithIssues)) {
    throw invalidSecurityResponse(model);
  }

  const issues = value.filesWithIssues.map((issue) => {
    if (
      issue === null
      || typeof issue !== 'object'
      || Array.isArray(issue)
      || typeof issue.path !== 'string'
      || issue.path.trim() === ''
      || !issueLevels.has(issue.level)
    ) {
      throw invalidSecurityResponse(model);
    }
    return { path: issue.path, level: issue.level };
  });

  return { scansDone: value.scansDone, issues };
}

function auditStatus({ scansDone, issues }) {
  if (issues.some((issue) => issue.level === 'unsafe')) return 'unsafe';
  if (issues.some((issue) => issue.level === 'caution')) return 'caution';
  return scansDone ? 'clean' : 'unscanned';
}

function invalidSecurityResponse(model) {
  return new Error(
    `Could not audit ${model.id}@${model.revision}: invalid security status response.`,
  );
}

function formatAuditSummary(results, paint) {
  const unsafe = results.flatMap((model) => model.issues)
    .filter((issue) => issue.level === 'unsafe').length;
  const caution = results.flatMap((model) => model.issues)
    .filter((issue) => issue.level === 'caution').length;
  const unscanned = results.filter((model) => !model.scansDone).length;
  const findingCount = unsafe + caution;
  const severities = [
    caution === 0 ? null : paint(`${caution} caution`, 'amber'),
    unsafe === 0 ? null : paint(`${unsafe} unsafe`, 'red'),
  ].filter(Boolean);
  const parts = [];
  if (findingCount > 0) {
    const findings = paint(
      `${findingCount} security ${plural('finding', findingCount)}`,
      unsafe > 0 ? 'red' : 'amber',
    );
    parts.push(`${findings} (${severities.join(', ')})`);
  }
  if (unscanned > 0) {
    if (findingCount === 0) parts.push(paint('0 security findings', 'green'));
    parts.push(
      paint(
        `Hub reports that not all scans are done for ${unscanned} ${plural('model', unscanned)}`,
        'amber',
      ),
    );
  }
  return parts.join('\n');
}

function modelRevisionUrl(model) {
  return `https://huggingface.co/${encodePath(model.id)}/tree/${encodeURIComponent(model.scannedRevision)}`;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function plural(noun, count) {
  return count === 1 ? noun : `${noun}s`;
}
