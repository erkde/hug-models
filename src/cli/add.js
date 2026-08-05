import { createModelConfig } from '../index.js';
import { fetchHubModel } from './hub.js';

const revisionFields = ['sha', 'lastModified'];

/**
 * Resolve and append a named model dependency to a manifest.
 *
 * @param {unknown} manifest
 * @param {{ name: string, id: string, track?: string }} model
 * @param {{ fetchImpl?: typeof fetch, token?: string, timeoutMs?: number }} [options]
 */
export async function addModel(
  manifest,
  model,
  {
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    timeoutMs,
  } = {},
) {
  const config = createModelConfig(manifest);
  const track = model.track ?? 'main';
  const pendingModel = {
    name: model.name,
    id: model.id,
    revision: 'pending',
    track,
  };

  // Validate the new name and fields before making a Hub request.
  createModelConfig({
    ...manifest,
    models: [...config.models, pendingModel],
  });

  const info = await fetchHubModel(model.id, track, {
    fields: revisionFields,
    fetchImpl,
    token,
    timeoutMs,
    action: 'resolve',
  });
  const addedModel = {
    name: model.name,
    id: model.id,
    revision: info.sha,
    track,
  };
  const nextManifest = {
    ...manifest,
    models: [...manifest.models, addedModel],
  };

  createModelConfig(nextManifest);
  return { manifest: nextManifest, model: addedModel };
}
