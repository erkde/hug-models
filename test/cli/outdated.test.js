import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli, shouldUseColor } from '../../src/cli/command.js';
import {
  calculateAgeDays,
  checkOutdatedModels,
  formatAge,
  formatOutdatedModels,
  formatOutdatedModelsJson,
  modelRevisionUrl,
} from '../../src/cli/outdated.js';

const pinnedRevision = 'a'.repeat(40);
const latestRevision = 'b'.repeat(40);
const now = Date.parse('2026-08-02T00:00:00.000Z');

test('builds a revision URL for a model and tracked branch', () => {
  assert.equal(
    modelRevisionUrl('owner/model name', 'release/next'),
    'https://huggingface.co/api/models/owner/model%20name/revision/release%2Fnext?expand[]=sha&expand[]=lastModified',
  );
});

test('checks model pins in parallel and preserves manifest order', async () => {
  const requested = [];
  const models = [
    { name: 'current', id: 'org/current', revision: pinnedRevision, track: 'main' },
    { name: 'stale', id: 'org/stale', revision: pinnedRevision, track: 'release' },
  ];

  const results = await checkOutdatedModels(models, {
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          sha: url.includes('/release?') ? latestRevision : pinnedRevision,
          lastModified: '2026-07-01T00:00:00.000Z',
        }),
      };
    },
  });

  assert.equal(requested.length, 2);
  assert.deepEqual(results.map(({ name, outdated }) => ({ name, outdated })), [
    { name: 'current', outdated: false },
    { name: 'stale', outdated: true },
  ]);
});

test('prints nothing when all model pins are current', () => {
  assert.equal(
    formatOutdatedModels([
      {
        id: 'org/current',
        revision: pinnedRevision,
        track: 'main',
        latestRevision: pinnedRevision,
        latestAt: '2026-07-01T00:00:00.000Z',
        outdated: false,
      },
    ]),
    '',
  );
});

test('formats outdated models as a table with relative age', () => {
  const output = formatOutdatedModels([
    {
      name: 'asr',
      id: 'org/stale',
      revision: pinnedRevision,
      track: 'main',
      latestRevision,
      latestAt: '2026-06-18T00:00:00.000Z',
      outdated: true,
    },
  ], { now });
  assert.match(output, /^Model\s+Current\s+Track\s+Latest\s+Status\s+Age$/m);
  assert.match(output, /^org\/stale\s+/m);
  assert.match(output, /aaaaaaa\s+main\s+bbbbbbb\s+outdated\s+1 month ago/);
});

test('formats ages in words', () => {
  assert.equal(formatAge('2026-08-01T23:59:45.000Z', now), 'just now');
  assert.equal(formatAge('2026-08-01T23:00:00.000Z', now), '1 hour ago');
  assert.equal(formatAge('2026-07-12T00:00:00.000Z', now), '21 days ago');
  assert.equal(formatAge('2025-08-02T00:00:00.000Z', now), '1 year ago');
  assert.equal(formatAge(undefined, now), 'unknown');
  assert.equal(calculateAgeDays('2026-07-05T00:00:00.000Z', now), 28);
});

test('colors age green below 30 days, amber below 90 days, and red thereafter', () => {
  const result = (days) =>
    formatOutdatedModels(
      [
        {
          id: `org/${days}`,
          revision: pinnedRevision,
          track: 'main',
          latestRevision,
          latestAt: new Date(now - days * 24 * 60 * 60_000).toISOString(),
          outdated: true,
        },
      ],
      { color: true, now },
    );

  assert.match(result(29), /\u001b\[32m29 days ago\u001b\[0m/);
  assert.match(result(30), /\u001b\[33m1 month ago\u001b\[0m/);
  assert.match(result(89), /\u001b\[33m2 months ago\u001b\[0m/);
  assert.match(result(90), /\u001b\[31m3 months ago\u001b\[0m/);
});

test('color does not change table alignment', () => {
  const models = [
    {
      id: 'org/stale',
      revision: pinnedRevision,
      track: 'main',
      latestRevision,
      latestAt: '2026-07-05T00:00:00.000Z',
      outdated: true,
    },
  ];
  const plain = formatOutdatedModels(models, { now });
  const colored = formatOutdatedModels(models, { color: true, now });

  assert.match(colored, /\u001b\[[\d;]*m/);
  assert.equal(colored.replace(/\u001b\[[\d;]*m/g, ''), plain);
});

test('respects standard color environment controls', () => {
  assert.equal(shouldUseColor({ env: {}, isTTY: true }), true);
  assert.equal(shouldUseColor({ env: { NO_COLOR: '' }, isTTY: true }), false);
  assert.equal(shouldUseColor({ env: { FORCE_COLOR: '1' }, isTTY: false }), true);
  assert.equal(shouldUseColor({ env: { FORCE_COLOR: '0' }, isTTY: true }), false);
});

test('formats JSON with full revisions, exact timestamps, and numeric age', () => {
  const latestAt = '2026-07-05T00:00:00.000Z';
  const output = formatOutdatedModelsJson(
    [
      {
        id: 'org/stale',
        revision: pinnedRevision,
        track: 'main',
        latestRevision,
        latestAt,
        outdated: true,
      },
      {
        id: 'org/current',
        revision: latestRevision,
        track: 'main',
        latestRevision,
        latestAt,
        outdated: false,
      },
    ],
    { now },
  );

  assert.deepEqual(JSON.parse(output), [
    {
      model: 'org/stale',
      current: pinnedRevision,
      track: 'main',
      latest: latestRevision,
      status: 'outdated',
      latestAt,
      ageDays: 28,
    },
  ]);
  assert.doesNotMatch(output, /\u001b\[/);
});

test('CLI honors --no-color and exits with one for an outdated pin', async () => {
  let output = '';
  const code = await runCli(['outdated', '--no-color'], {
    cwd: '/project',
    color: true,
    readFileImpl: async (path) => {
      assert.equal(path, '/project/hug-models.json');
      return JSON.stringify({
        models: [{ id: 'org/model', revision: pinnedRevision, track: 'main' }],
      });
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        sha: latestRevision,
        lastModified: '2026-06-18T00:00:00.000Z',
      }),
    }),
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 1);
  assert.match(output, /org\/model/);
  assert.match(output, /aaaaaaa\s+main\s+bbbbbbb\s+outdated/);
  assert.doesNotMatch(output, /\u001b\[[\d;]*m/);
});

test('CLI is quiet and exits with zero when every pin is current', async () => {
  let writes = 0;
  const code = await runCli(['outdated'], {
    readFileImpl: async () =>
      JSON.stringify({ models: [{ id: 'org/model', revision: pinnedRevision }] }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        sha: pinnedRevision,
        lastModified: '2026-06-18T00:00:00.000Z',
      }),
    }),
    write: () => {
      writes += 1;
    },
  });

  assert.equal(code, 0);
  assert.equal(writes, 0);
});

test('CLI supports JSON with a custom manifest path and never emits color', async () => {
  let output = '';
  const code = await runCli(['outdated', '--json', '--no-color', 'models.json'], {
    cwd: '/project',
    color: true,
    now,
    readFileImpl: async (path) => {
      assert.equal(path, '/project/models.json');
      return JSON.stringify({ models: [{ id: 'org/model', revision: pinnedRevision }] });
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        sha: latestRevision,
        lastModified: '2026-07-05T00:00:00.000Z',
      }),
    }),
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 1);
  assert.equal(JSON.parse(output)[0].ageDays, 28);
  assert.doesNotMatch(output, /\u001b\[/);
});

test('reports Hub errors with the model and tracked revision', async () => {
  await assert.rejects(
    checkOutdatedModels(
      [{ id: 'org/private', revision: pinnedRevision, track: 'stable' }],
      {
        fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
      },
    ),
    /org\/private@stable.*404 Not Found/,
  );
});

test('rejects a Hub response without a valid latest timestamp', async () => {
  await assert.rejects(
    checkOutdatedModels(
      [{ id: 'org/model', revision: pinnedRevision, track: 'main' }],
      {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ sha: latestRevision, lastModified: 'not-a-date' }),
        }),
      },
    ),
    /invalid lastModified response/,
  );
});
