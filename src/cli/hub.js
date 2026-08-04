const DEFAULT_ENDPOINT = 'https://huggingface.co';
const DEFAULT_TIMEOUT_MS = 10_000;
const revisionPattern = /^[a-f\d]{40}$/i;

/**
 * Build a Hub API URL for selected model metadata at a branch or tag.
 *
 * @param {string} modelId
 * @param {string} track
 * @param {string[]} fields
 * @param {string} [endpoint]
 */
export function hubModelUrl(modelId, track, fields, endpoint = DEFAULT_ENDPOINT) {
  const encodedId = modelId.split('/').map(encodeURIComponent).join('/');
  const expandedFields = fields
    .map((field) => `expand[]=${encodeURIComponent(field)}`)
    .join('&');
  return `${endpoint}/api/models/${encodedId}/revision/${encodeURIComponent(track)}?${expandedFields}`;
}

/**
 * Build a Hub API URL that includes the repository security scan status.
 *
 * @param {string} modelId
 * @param {string} revision
 * @param {string} [endpoint]
 */
export function hubModelSecurityUrl(modelId, revision, endpoint = DEFAULT_ENDPOINT) {
  const encodedId = modelId.split('/').map(encodeURIComponent).join('/');
  return `${endpoint}/api/models/${encodedId}/revision/${encodeURIComponent(revision)}?securityStatus=true`;
}

/**
 * Retrieve and validate model metadata from the Hub.
 *
 * @param {string} modelId
 * @param {string} track
 * @param {{
 *   fields: string[],
 *   fetchImpl?: typeof fetch,
 *   token?: string,
 *   timeoutMs?: number,
 *   action?: string,
 * }} options
 */
export async function fetchHubModel(
  modelId,
  track,
  {
    fields,
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    action = 'retrieve',
  },
) {
  return fetchHubModelResponse(modelId, track, hubModelUrl(modelId, track, fields), {
    fetchImpl,
    token,
    timeoutMs,
    action,
  });
}

/**
 * Retrieve model metadata including the Hub security scan status.
 *
 * @param {string} modelId
 * @param {string} revision
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   token?: string,
 *   timeoutMs?: number,
 *   action?: string,
 * }} [options]
 */
export async function fetchHubModelSecurity(
  modelId,
  revision,
  {
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    action = 'audit',
  } = {},
) {
  return fetchHubModelResponse(
    modelId,
    revision,
    hubModelSecurityUrl(modelId, revision),
    { fetchImpl, token, timeoutMs, action },
  );
}

async function fetchHubModelResponse(
  modelId,
  revision,
  url,
  { fetchImpl, token, timeoutMs, action },
) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required to retrieve model information.');
  }

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const status = `${response.status} ${response.statusText ?? ''}`.trim();
    throw new Error(
      `Could not ${action} ${modelId}@${revision}: Hugging Face returned ${status}.`,
    );
  }

  const info = await response.json();
  if (!revisionPattern.test(info.sha ?? '')) {
    throw new Error(`Could not ${action} ${modelId}@${revision}: invalid revision response.`);
  }
  if (Number.isNaN(Date.parse(info.lastModified ?? ''))) {
    throw new Error(`Could not ${action} ${modelId}@${revision}: invalid lastModified response.`);
  }

  return info;
}
