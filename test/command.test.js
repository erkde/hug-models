import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runCli } from '../src/command.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

test('CLI shows generated help when called without a command', async () => {
  let output = '';
  const code = await runCli([], {
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.match(output, /^Usage: hug-models \[options\] \[command\]/m);
  assert.match(output, /^\s+audit \[options\] \[manifest\]/m);
  assert.match(output, /^\s+outdated \[options\] \[manifest\]/m);
  assert.match(output, /^\s+info \[options\] \[model\] \[manifest\]/m);
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
