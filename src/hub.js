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
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required to retrieve model information.');
  }

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(hubModelUrl(modelId, track, fields), {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const status = `${response.status} ${response.statusText ?? ''}`.trim();
    throw new Error(
      `Could not ${action} ${modelId}@${track}: Hugging Face returned ${status}.`,
    );
  }

  const info = await response.json();
  if (!revisionPattern.test(info.sha ?? '')) {
    throw new Error(`Could not ${action} ${modelId}@${track}: invalid revision response.`);
  }
  if (Number.isNaN(Date.parse(info.lastModified ?? ''))) {
    throw new Error(`Could not ${action} ${modelId}@${track}: invalid lastModified response.`);
  }

  return info;
}
