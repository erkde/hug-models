import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from '../../src/cli/command.js';
import {
  formatModelInfo,
  formatModelInfoJson,
  getModelInfo,
  modelInfoUrl,
} from '../../src/cli/info.js';

const pinnedRevision = 'a'.repeat(40);
const latestRevision = 'b'.repeat(40);
const latestAt = '2026-07-05T00:00:00.000Z';
const now = Date.parse('2026-08-02T00:00:00.000Z');

function hubResponse(overrides = {}) {
  return {
    sha: latestRevision,
    lastModified: latestAt,
    pipeline_tag: 'automatic-speech-recognition',
    library_name: 'transformers.js',
    cardData: { license: 'apache-2.0' },
    tags: [
      'transformers.js',
      'onnx',
      'moonshine',
      'automatic-speech-recognition',
      'base_model:org/base',
      'license:apache-2.0',
      'region:us',
    ],
    private: false,
    gated: false,
    ...overrides,
  };
}

test('builds a model information URL with encoded identifiers and track', () => {
  const url = modelInfoUrl('owner/model name', 'release/next');
  assert.match(
    url,
    /^https:\/\/huggingface\.co\/api\/models\/owner\/model%20name\/revision\/release%2Fnext\?/,
  );
  assert.match(url, /expand\[\]=cardData/);
  assert.match(url, /expand\[\]=sha/);
});

test('retrieves Hub metadata and compares a pinned revision', async () => {
  const requested = [];
  const result = await getModelInfo(
    {
      name: 'asr',
      id: 'org/model',
      revision: pinnedRevision,
      track: 'main',
    },
    {
      token: 'secret',
      fetchImpl: async (url, options) => {
        requested.push({ url, options });
        return { ok: true, json: async () => hubResponse() };
      },
    },
  );

  assert.equal(requested.length, 1);
  assert.equal(requested[0].options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(result, {
    name: 'asr',
    id: 'org/model',
    revision: pinnedRevision,
    track: 'main',
    latestRevision,
    latestAt,
    outdated: true,
    task: 'automatic-speech-recognition',
    library: 'transformers.js',
    license: 'apache-2.0',
    tags: ['onnx', 'moonshine'],
    private: false,
    gated: false,
  });
});

test('formats readable model information with full revisions', async () => {
  const model = await getModelInfo(
    { id: 'org/model', revision: pinnedRevision, track: 'main' },
    { fetchImpl: async () => ({ ok: true, json: async () => hubResponse() }) },
  );
  const output = formatModelInfo(model, { now });

  assert.match(output, /^org\/model \| automatic-speech-recognition \| transformers\.js$/m);
  assert.match(output, new RegExp(`^Current:\\s+${pinnedRevision}$`, 'm'));
  assert.match(output, new RegExp(`^Latest:\\s+${latestRevision}$`, 'm'));
  assert.match(output, /^Status:\s+outdated$/m);
  assert.match(output, /^Updated:\s+28 days ago \(2026-07-05T00:00:00.000Z\)$/m);
  assert.match(output, /^Tags: onnx, moonshine$/m);
  assert.match(output, /^Access: public$/m);
});

test('formats stable JSON for a directly inspected model', async () => {
  const model = await getModelInfo(
    { id: 'org/model', track: 'main' },
    { fetchImpl: async () => ({ ok: true, json: async () => hubResponse() }) },
  );
  const output = formatModelInfoJson(model, { now });

  assert.deepEqual(JSON.parse(output), {
    model: 'org/model',
    url: 'https://huggingface.co/org/model',
    current: null,
    track: 'main',
    latest: latestRevision,
    status: 'untracked',
    latestAt,
    ageDays: 28,
    task: 'automatic-speech-recognition',
    library: 'transformers.js',
    license: 'apache-2.0',
    tags: ['onnx', 'moonshine'],
    private: false,
    gated: false,
  });
  assert.doesNotMatch(output, /\u001b\[/);
});

test('colors age only when a newer revision is available', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => hubResponse() });
  const current = await getModelInfo(
    { id: 'org/model', revision: latestRevision },
    { fetchImpl },
  );
  const outdated = await getModelInfo(
    { id: 'org/model', revision: pinnedRevision },
    { fetchImpl },
  );
  const direct = await getModelInfo({ id: 'org/model' }, { fetchImpl });

  const currentOutput = formatModelInfo(current, { color: true, now });
  const outdatedOutput = formatModelInfo(outdated, { color: true, now });
  const directOutput = formatModelInfo(direct, { color: true, now });

  const relativeAge = (output) => output.match(/^Updated:\s+(.+) \(/m)[1];
  const ansiPattern = /\u001b\[[\d;]*m/;
  assert.doesNotMatch(relativeAge(currentOutput), ansiPattern);
  assert.match(relativeAge(outdatedOutput), ansiPattern);
  assert.doesNotMatch(relativeAge(directOutput), ansiPattern);
});

test('CLI resolves a named manifest model and exits with zero when it is outdated', async () => {
  let output = '';
  const code = await runCli(['info', 'asr'], {
    cwd: '/project',
    color: false,
    now,
    readFileImpl: async (path) => {
      assert.equal(path, '/project/hug-models.json');
      return JSON.stringify({
        models: [{
          name: 'asr',
          id: 'org/model',
          revision: pinnedRevision,
          track: 'stable',
        }],
      });
    },
    fetchImpl: async (url) => {
      assert.match(url, /\/org\/model\/revision\/stable\?/);
      return { ok: true, json: async () => hubResponse() };
    },
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.match(output, /^Status:\s+outdated$/m);
  assert.match(output, new RegExp(latestRevision));
});

test('CLI can inspect a direct Hub model without a manifest', async () => {
  let output = '';
  const missingManifest = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const code = await runCli(['info', 'org/model', '--track', 'release', '--json'], {
    cwd: '/project',
    now,
    readFileImpl: async () => {
      throw missingManifest;
    },
    fetchImpl: async (url) => {
      assert.match(url, /\/org\/model\/revision\/release\?/);
      return { ok: true, json: async () => hubResponse() };
    },
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.equal(JSON.parse(output).status, 'untracked');
});

test('CLI accepts a custom manifest after the model name', async () => {
  const code = await runCli(['info', 'asr', 'config/models.json'], {
    cwd: '/project',
    readFileImpl: async (path) => {
      assert.equal(path, '/project/config/models.json');
      return JSON.stringify({
        models: [{ name: 'asr', id: 'org/model', revision: latestRevision }],
      });
    },
    fetchImpl: async () => ({ ok: true, json: async () => hubResponse() }),
    write: () => {},
  });

  assert.equal(code, 0);
});

test('reports Hub errors for model information requests', async () => {
  await assert.rejects(
    getModelInfo(
      { id: 'org/private', track: 'stable' },
      { fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found' }) },
    ),
    /org\/private@stable.*404 Not Found/,
  );
});
