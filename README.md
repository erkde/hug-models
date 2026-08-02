# hug-models

Configure and maintain model dependencies for Transformers.js applications.

`hug-models` keeps model repository IDs and pinned revisions in a small JSON
manifest, validates that manifest at runtime, and provides convenient model
lookup for applications that use one or more Hugging Face models.

This is a community-maintained project and is not affiliated with Hugging Face.

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

## Check for outdated pins

Run the `outdated` command from the directory containing `hug-models.json`:

```sh
npx hug-models outdated
```

You can pass a different manifest path when needed:

```sh
npx hug-models outdated config/models.json
```

The command resolves each model's `track` on the Hugging Face Hub and compares
its commit with the pinned `revision`. Like `npm outdated`, it prints nothing
and exits with status `0` when every pin is current. Otherwise it prints a table
with abbreviated current and latest commits, tracked branch or tag, status, and
the age of the latest commit on that branch or tag, then exits with status `1`.

In an interactive terminal, ages under 30 days are green, ages from 30 through
89 days are amber, and ages of 90 days or more are red. Set `NO_COLOR` to disable
color or `FORCE_COLOR=1` to enable it when output is not connected to a terminal.

Use `--no-color` to explicitly disable color. For scripts, `--json` returns full
commit hashes, the exact latest commit timestamp, and its numeric age in whole
days. JSON output never includes terminal color codes:

```sh
npx hug-models outdated --json
```

```json
[
  {
    "model": "onnx-community/moonshine-tiny-ONNX",
    "current": "2e9aab599b84ee5aa2b305757e92c656d9ae638f",
    "track": "main",
    "latest": "a6da1241cd305dcd64eab1edbd615f2bb9aabb95",
    "status": "outdated",
    "latestAt": "2025-01-17T00:00:00.000Z",
    "ageDays": 562
  }
]
```

Set `HF_TOKEN` when checking a private or gated model that your account can
access.

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
