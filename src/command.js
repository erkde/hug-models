import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createModelConfig } from './index.js';
import {
  checkOutdatedModels,
  formatOutdatedModels,
  formatOutdatedModelsJson,
} from './outdated.js';

export const help = `Usage: hug-models outdated [manifest] [--json] [--no-color]

Check pinned model revisions against their tracked Hugging Face branches or tags.
The manifest defaults to ./hug-models.json.

Options:
  --json      Print stable JSON with full revisions and exact timestamps.
  --no-color  Disable colors even when output is an interactive terminal.`;

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

  if (args[0] !== 'outdated') {
    throw new Error(`Unknown command "${args[0]}".\n\n${help}`);
  }

  const commandArgs = parseOutdatedArgs(args.slice(1));
  if (commandArgs.help) {
    write(help);
    return 0;
  }

  const manifestPath = resolve(cwd, commandArgs.manifest ?? 'hug-models.json');
  let source;
  try {
    source = await readFileImpl(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Model manifest not found: ${manifestPath}`);
    }
    throw error;
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse ${manifestPath}: ${error.message}`);
  }

  const config = createModelConfig(manifest);
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
