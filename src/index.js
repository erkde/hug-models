export class ConfigValidationError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate a hug-models manifest and expose convenient model lookup.
 *
 * @param {unknown} manifest
 */
export function createModelConfig(manifest) {
  if (!isObject(manifest)) {
    throw new ConfigValidationError('The model manifest must be an object.');
  }

  if (!Array.isArray(manifest.models)) {
    throw new ConfigValidationError('The model manifest must contain a models array.');
  }

  const names = new Map();
  const models = manifest.models.map((entry, index) => {
    const location = `models[${index}]`;
    if (!isObject(entry)) {
      throw new ConfigValidationError(`${location} must be an object.`);
    }

    requireNonEmptyString(entry.id, `${location}.id`);
    requireNonEmptyString(entry.revision, `${location}.revision`);

    if (entry.name !== undefined) {
      requireNonEmptyString(entry.name, `${location}.name`);
      if (names.has(entry.name)) {
        throw new ConfigValidationError(
          `${location}.name duplicates the name used by models[${names.get(entry.name)}]: ${entry.name}`,
        );
      }
      names.set(entry.name, index);
    }

    if (entry.track !== undefined) {
      requireNonEmptyString(entry.track, `${location}.track`);
    }

    return {
      ...entry,
      track: entry.track ?? 'main',
    };
  });

  const config = { ...manifest, models };
  Object.defineProperty(config, 'get', {
    enumerable: false,
    value(name) {
      if (name === undefined) {
        if (models.length === 1) return models[0];
        throw new ConfigValidationError(
          `A model name is required because the manifest contains ${models.length} models.`,
        );
      }

      const index = names.get(name);
      if (index === undefined) {
        throw new ConfigValidationError(`No model is named "${name}".`);
      }
      return models[index];
    },
  });

  return config;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value, location) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigValidationError(`${location} must be a non-empty string.`);
  }
}
