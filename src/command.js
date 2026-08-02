import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createModelConfig } from './index.js';
import {
  checkOutdatedModels,
  formatOutdatedModels,
  formatOutdatedModelsJson,
} from './outdated.js';
import { formatModelInfo, formatModelInfoJson, getModelInfo } from './info.js';

export const help = `Usage:
  hug-models outdated [manifest] [--json] [--no-color]
  hug-models info [model] [manifest] [--track <branch-or-tag>] [--json] [--no-color]

Commands:
  outdated  Check pinned revisions against their tracked branches or tags.
  info      Show update details and Hub metadata for one model.

Options:
  --json              Print stable JSON with full revisions and exact timestamps.
  --no-color          Disable colors even when output is an interactive terminal.
  --track <revision>  Inspect a branch or tag (info only; defaults to main).
  -h, --help          Show help.`;

export function shouldUseColor({ env = process.env, isTTY = process.stdout.isTTY } = {}) {
  if (Object.hasOwn(env, 'NO_COLOR')) return false;
  if (Object.hasOwn(env, 'FORCE_COLOR')) return env.FORCE_COLOR !== '0';
  return Boolean(isTTY);
}

/**
 * Run the command line interface with injectable dependencies for testing.
 *
 * @param {string[]} args
 * @param {object} [options]
 */
export async function runCli(
  args,
  {
    cwd = process.cwd(),
    readFileImpl = readFile,
    fetchImpl = globalThis.fetch,
    token = process.env.HF_TOKEN,
    write = console.log,
    color = shouldUseColor(),
    now = Date.now(),
  } = {},
) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    write(help);
    return 0;
  }

  if (args[0] !== 'outdated' && args[0] !== 'info') {
    throw new Error(`Unknown command "${args[0]}".\n\n${help}`);
  }

  const command = args[0];
  const commandArgs = command === 'outdated'
    ? parseOutdatedArgs(args.slice(1))
    : parseInfoArgs(args.slice(1));
  if (commandArgs.help) {
    write(help);
    return 0;
  }

  if (command === 'info') {
    const model = await resolveInfoModel(commandArgs, { cwd, readFileImpl });
    const result = await getModelInfo(
      {
        ...model,
        track: commandArgs.track ?? model.track,
      },
      { fetchImpl, token },
    );
    write(commandArgs.json
      ? formatModelInfoJson(result, { now })
      : formatModelInfo(result, { color: color && !commandArgs.noColor, now }));
    return 0;
  }

  const manifestPath = resolve(cwd, commandArgs.manifest ?? 'hug-models.json');
  const config = await readModelConfig(manifestPath, readFileImpl);
  const results = await checkOutdatedModels(config.models, { fetchImpl, token });
  if (commandArgs.json) {
    write(formatOutdatedModelsJson(results, { now }));
  } else {
    const output = formatOutdatedModels(results, {
      color: color && !commandArgs.noColor,
      now,
    });
    if (output) write(output);
  }
  return results.some((model) => model.outdated) ? 1 : 0;
}

function parseOutdatedArgs(args) {
  const options = { json: false, noColor: false, manifest: undefined };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      return { ...options, help: true };
    }
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--no-color') {
      options.noColor = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}".\n\n${help}`);
    } else if (options.manifest === undefined) {
      options.manifest = arg;
    } else {
      throw new Error(`The outdated command accepts at most one manifest path.\n\n${help}`);
    }
  }

  return options;
}

function parseInfoArgs(args) {
  const options = {
    json: false,
    noColor: false,
    model: undefined,
    manifest: undefined,
    track: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      return { ...options, help: true };
    }
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--no-color') {
      options.noColor = true;
    } else if (arg === '--track') {
      const track = args[index + 1];
      if (track === undefined || track.startsWith('-')) {
        throw new Error(`The --track option requires a branch or tag.\n\n${help}`);
      }
      options.track = track;
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}".\n\n${help}`);
    } else if (options.model === undefined) {
      options.model = arg;
    } else if (options.manifest === undefined) {
      options.manifest = arg;
    } else {
      throw new Error(`The info command accepts at most a model and manifest path.\n\n${help}`);
    }
  }

  return options;
}

async function resolveInfoModel(commandArgs, { cwd, readFileImpl }) {
  const manifestPath = resolve(cwd, commandArgs.manifest ?? 'hug-models.json');

  if (commandArgs.model === undefined || commandArgs.manifest !== undefined) {
    const config = await readModelConfig(manifestPath, readFileImpl);
    return findManifestModel(config, commandArgs.model);
  }

  try {
    const config = await readModelConfig(manifestPath, readFileImpl);
    const match = config.models.find(
      (model) => model.name === commandArgs.model || model.id === commandArgs.model,
    );
    if (match) return match;
  } catch (error) {
    if (error?.cause?.code !== 'ENOENT') throw error;
  }

  return {
    id: commandArgs.model,
    track: commandArgs.track ?? 'main',
  };
}

function findManifestModel(config, name) {
  if (name === undefined) return config.get();
  const byId = config.models.find((model) => model.id === name);
  return byId ?? config.get(name);
}

async function readModelConfig(manifestPath, readFileImpl) {
  let source;
  try {
    source = await readFileImpl(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Model manifest not found: ${manifestPath}`, { cause: error });
    }
    throw error;
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse ${manifestPath}: ${error.message}`);
  }

  return createModelConfig(manifest);
}
