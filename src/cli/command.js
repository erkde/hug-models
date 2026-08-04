import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import {
  auditModels,
  formatAuditResults,
  formatAuditResultsJson,
  hasAuditProblems,
} from './audit.js';
import { createModelConfig } from '../index.js';
import {
  checkOutdatedModels,
  formatOutdatedModels,
  formatOutdatedModelsJson,
} from './outdated.js';
import { formatModelInfo, formatModelInfoJson, getModelInfo } from './info.js';

const require = createRequire(import.meta.url);
const { description, version } = require('../../package.json');

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
  let exitCode = 0;
  const dependencies = { cwd, readFileImpl, fetchImpl, token, write, color, now };
  const program = createProgram({
    write,
    setExitCode: (value) => {
      exitCode = value;
    },
    dependencies,
  });

  try {
    await program.parseAsync(args.length === 0 ? ['--help'] : args, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return error.exitCode;
      }
      throw new Error(error.message.replace(/^error: /, ''), { cause: error });
    }
    throw error;
  }

  return exitCode;
}

function createProgram({ write, setExitCode, dependencies }) {
  const program = new Command()
    .name('hug-models')
    .description(description)
    .version(version)
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (value) => write(value.replace(/\n$/, '')),
      writeErr: () => {},
    });

  program
    .command('audit')
    .description('Check pinned model revisions for Hub security findings.')
    .argument('[manifest]', 'path to the model manifest', 'hug-models.json')
    .option('--json', 'print stable JSON with full revisions and security findings')
    .option('--no-color', 'disable colors even when output is an interactive terminal')
    .action(async (manifest, options) => {
      setExitCode(await runAudit({ manifest, ...options }, dependencies));
    });

  program
    .command('outdated')
    .description('Check pinned revisions against their tracked branches or tags.')
    .argument('[manifest]', 'path to the model manifest', 'hug-models.json')
    .option('--json', 'print stable JSON with full revisions and exact timestamps')
    .option('--no-color', 'disable colors even when output is an interactive terminal')
    .action(async (manifest, options) => {
      setExitCode(await runOutdated({ manifest, ...options }, dependencies));
    });

  program
    .command('info')
    .description('Show update details and Hub metadata for one model.')
    .argument('[model]', 'model name or Hugging Face model ID')
    .argument('[manifest]', 'path to the model manifest')
    .option('--track <branch-or-tag>', 'inspect a branch or tag')
    .option('--json', 'print stable JSON with full revisions and exact timestamps')
    .option('--no-color', 'disable colors even when output is an interactive terminal')
    .action(async (model, manifest, options) => {
      await runInfo({ model, manifest, ...options }, dependencies);
      setExitCode(0);
    });

  return program;
}

async function runAudit(commandArgs, {
  cwd,
  readFileImpl,
  fetchImpl,
  token,
  write,
  color,
}) {
  const manifestPath = resolve(cwd, commandArgs.manifest);
  const config = await readModelConfig(manifestPath, readFileImpl);
  const results = await auditModels(config.models, { fetchImpl, token });
  write(commandArgs.json
    ? formatAuditResultsJson(results)
    : formatAuditResults(results, { color: color && commandArgs.color !== false }));
  return hasAuditProblems(results) ? 1 : 0;
}

async function runOutdated(commandArgs, {
  cwd,
  readFileImpl,
  fetchImpl,
  token,
  write,
  color,
  now,
}) {
  const manifestPath = resolve(cwd, commandArgs.manifest);
  const config = await readModelConfig(manifestPath, readFileImpl);
  const results = await checkOutdatedModels(config.models, { fetchImpl, token });
  if (commandArgs.json) {
    write(formatOutdatedModelsJson(results, { now }));
  } else {
    const output = formatOutdatedModels(results, {
      color: color && commandArgs.color !== false,
      now,
    });
    if (output) write(output);
  }
  return results.some((model) => model.outdated) ? 1 : 0;
}

async function runInfo(commandArgs, {
  cwd,
  readFileImpl,
  fetchImpl,
  token,
  write,
  color,
  now,
}) {
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
    : formatModelInfo(result, { color: color && commandArgs.color !== false, now }));
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
