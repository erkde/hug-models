# hug-models

Configure and maintain model dependencies for Transformers.js applications.

`hug-models` keeps model repository IDs and pinned revisions in a small JSON
manifest, validates that manifest at runtime, and provides convenient model
lookup for applications that use one or more Hugging Face models.

## Install

```sh
npm install hug-models
```

## Create a manifest

Create a `hug-models.json` file in your application:

```json
{
  "$schema": "./node_modules/hug-models/schema.json",
  "models": [
    {
      "name": "asr",
      "id": "onnx-community/moonshine-tiny-ONNX",
      "revision": "a6da1241cd305dcd64eab1edbd615f2bb9aabb95",
      "track": "main"
    }
  ]
}
```

The `revision` should be a pinned Hugging Face commit rather than a moving
branch name. `track` records the branch or tag to check for newer revisions and
defaults to `main` when omitted.

The bundled JSON Schema provides editor completion and validates the manifest
shape. Depending on your editor, you can also reference the package export as
`hug-models/schema.json`.

## Load the configuration

```js
import { createModelConfig } from "hug-models";
import manifest from "./hug-models.json" with { type: "json" };

const models = createModelConfig(manifest);
const asrModel = models.get("asr");

console.log(asrModel.id);
console.log(asrModel.revision);
```

For a manifest containing exactly one model, its name may be omitted and the
model can be retrieved without an argument:

```js
const model = createModelConfig({
  models: [
    {
      id: "Xenova/all-MiniLM-L6-v2",
      revision: "abc123",
    },
  ],
}).get();
```

Calling `get()` without a name on a multi-model manifest is an error. Named
models must have unique names.

## Manifest fields

| Field               | Required | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `models`            | Yes      | Array of model definitions.                            |
| `models[].id`       | Yes      | Hugging Face model repository ID.                      |
| `models[].revision` | Yes      | Pinned model revision, normally a commit SHA.          |
| `models[].name`     | No       | Application-defined name used by `get(name)`.          |
| `models[].track`    | No       | Upstream branch or tag to monitor; defaults to `main`. |

Invalid manifests throw `ConfigValidationError`, which extends `TypeError`:

```js
import { ConfigValidationError, createModelConfig } from "hug-models";

try {
  createModelConfig(manifest);
} catch (error) {
  if (error instanceof ConfigValidationError) {
    console.error(`Invalid model manifest: ${error.message}`);
  }
}
```

## API

### `createModelConfig(manifest)`

Validates a manifest and returns a configuration object. Each returned model
has a `track` value, including models where the default was omitted.

### `config.get(name?)`

Returns the named model. The name is optional only when the manifest contains
exactly one model.

### `ConfigValidationError`

Thrown when a manifest or model definition is malformed, a model name is
duplicated, or lookup cannot select a model unambiguously.

## Development

```sh
npm test
```

## License

MIT
