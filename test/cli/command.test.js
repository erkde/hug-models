import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runCli } from '../../src/cli/command.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

test('CLI shows generated help when called without a command', async () => {
  let output = '';
  const code = await runCli([], {
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.match(output, /^Usage: hug-models \[options\] \[command\]/m);
  assert.match(output, /^\s+add \[options\] <model>/m);
  assert.match(output, /^\s+init\s+Create an empty model manifest\./m);
  assert.match(output, /^\s+audit \[options\] \[manifest\]/m);
  assert.match(output, /^\s+outdated \[options\] \[manifest\]/m);
  assert.match(output, /^\s+info \[options\] \[model\] \[manifest\]/m);
});

test('CLI initializes the default manifest without overwriting files', async () => {
  let written;
  let output = '';
  const code = await runCli(['init'], {
    cwd: '/project',
    writeFileImpl: async (path, contents, options) => {
      written = { path, contents, options };
    },
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(written, {
    path: '/project/hug-models.json',
    contents: `${JSON.stringify({
      $schema: './node_modules/hug-models/schema.json',
      models: [],
    }, null, 2)}\n`,
    options: {
      encoding: 'utf8',
      flag: 'wx',
    },
  });
  assert.equal(output, 'Created hug-models.json');
});

test('CLI refuses to overwrite an existing manifest', async () => {
  const cause = Object.assign(new Error('already exists'), { code: 'EEXIST' });

  await assert.rejects(
    runCli(['init'], {
      cwd: '/project',
      writeFileImpl: async () => {
        throw cause;
      },
      write: () => assert.fail('failed init should not print success'),
    }),
    (error) => {
      assert.equal(error.message, 'Model manifest already exists: /project/hug-models.json');
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test('CLI shows command-specific help without running the command', async () => {
  let output = '';
  const code = await runCli(['info', '--help'], {
    readFileImpl: async () => assert.fail('help should not read a manifest'),
    fetchImpl: async () => assert.fail('help should not call the Hub'),
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.match(output, /^Usage: hug-models info \[options\] \[model\] \[manifest\]/m);
  assert.match(output, /--track <branch-or-tag>/);
});

test('CLI reports unknown options and excess arguments', async () => {
  await assert.rejects(
    runCli(['add', 'org/model']),
    /required option '--name <name>' not specified/,
  );
  await assert.rejects(
    runCli(['outdated', '--unknown']),
    /unknown option '--unknown'/,
  );
  await assert.rejects(
    runCli(['outdated', 'one.json', 'two.json']),
    /too many arguments/,
  );
});

test('CLI exposes the package version', async () => {
  let output = '';
  const code = await runCli(['--version'], {
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.equal(output, version);
});
