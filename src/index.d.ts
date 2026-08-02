export interface ModelDefinition {
  name?: string;
  id: string;
  revision: string;
  track?: string;
}

export interface ModelManifest {
  $schema?: string;
  models: ModelDefinition[];
}

export interface ModelConfig extends ModelManifest {
  models: Array<ModelDefinition & {
    track: string;
  }>;
  get(name?: string): ModelConfig['models'][number];
}

export class ConfigValidationError extends TypeError {}

export function createModelConfig(manifest: unknown): ModelConfig;
