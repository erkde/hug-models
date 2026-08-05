import assert from 'node:assert/strict';
import test from 'node:test';
import { addModel } from '../../src/cli/add.js';
import { runCli } from '../../src/cli/command.js';

const revision = 'b'.repeat(40);
const latestAt = '2026-08-05T00:00:00.000Z';

function hubResponse() {
  return {
    sha: revision,
    lastModified: latestAt,
  };
}

test('adds a named model pinned to its tracked Hub revision', async () => {
  const requested = [];
  const source = {
    $schema: './node_modules/hug-models/schema.json',
    models: [{
      name: 'existing',
      id: 'org/existing',
      revision: 'a'.repeat(40),
    }],
  };
  const result = await addModel(
    source,
    { name: 'asr', id: 'org/model', track: 'release/next' },
    {
      token: 'secret',
      fetchImpl: async (url, options) => {
        requested.push({ url, options });
        return { ok: true, json: async () => hubResponse() };
      },
    },
  );

  assert.match(requested[0].url, /\/org\/model\/revision\/release%2Fnext\?/);
  assert.equal(requested[0].options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(result, {
    manifest: {
      ...source,
      models: [
        ...source.models,
        {
          name: 'asr',
          id: 'org/model',
          revision,
          track: 'release/next',
        },
      ],
    },
    model: {
      name: 'asr',
      id: 'org/model',
      revision,
      track: 'release/next',
    },
  });
});

test('allows one Hub model ID under multiple unique names', async () => {
  const result = await addModel(
    {
      models: [{
        name: 'stable',
        id: 'org/model',
        revision: 'a'.repeat(40),
        track: 'stable',
      }],
    },
    { name: 'canary', id: 'org/model' },
    { fetchImpl: async () => ({ ok: true, json: async () => hubResponse() }) },
  );

  assert.deepEqual(result.manifest.models.map(({ name, id }) => ({ name, id })), [
    { name: 'stable', id: 'org/model' },
    { name: 'canary', id: 'org/model' },
  ]);
});

test('rejects a duplicate name before requesting the Hub', async () => {
  await assert.rejects(
    addModel(
      {
        models: [{ name: 'asr', id: 'org/stable', revision: 'a'.repeat(40) }],
      },
      { name: 'asr', id: 'org/canary' },
      { fetchImpl: async () => assert.fail('duplicate name should not request the Hub') },
    ),
    /name duplicates the name used by models\[0\]: asr/,
  );
});

test('CLI adds a model to the default manifest', async () => {
  let written;
  let output = '';
  const code = await runCli(['add', 'org/model', '--name', 'asr'], {
    cwd: '/project',
    readFileImpl: async (path) => {
      assert.equal(path, '/project/hug-models.json');
      return JSON.stringify({
        $schema: './node_modules/hug-models/schema.json',
        models: [],
      });
    },
    writeFileImpl: async (path, contents, options) => {
      written = { path, contents, options };
    },
    fetchImpl: async (url) => {
      assert.match(url, /\/org\/model\/revision\/main\?/);
      return { ok: true, json: async () => hubResponse() };
    },
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.equal(written.path, '/project/hug-models.json');
  assert.deepEqual(JSON.parse(written.contents).models, [{
    name: 'asr',
    id: 'org/model',
    revision,
    track: 'main',
  }]);
  assert.deepEqual(written.options, { encoding: 'utf8' });
  assert.equal(output, `Added asr: org/model@${revision} (main)`);
});

test('CLI leaves the manifest untouched when the Hub request fails', async () => {
  await assert.rejects(
    runCli(['add', 'org/missing', '--name', 'asr'], {
      cwd: '/project',
      readFileImpl: async () => JSON.stringify({ models: [] }),
      writeFileImpl: async () => assert.fail('failed add should not write the manifest'),
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }),
      write: () => assert.fail('failed add should not print success'),
    }),
    /Could not resolve org\/missing@main: Hugging Face returned 404 Not Found/,
  );
});
