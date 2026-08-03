import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditModels,
  formatAuditResults,
  formatAuditResultsJson,
  hasAuditProblems,
  modelAuditUrl,
} from '../src/audit.js';
import { runCli } from '../src/command.js';

const pinnedRevision = 'a'.repeat(40);
const secondRevision = 'b'.repeat(40);
const lastModified = '2026-07-05T00:00:00.000Z';
const ansiPattern = /\u001b\[[\d;]*m/g;

function hubResponse(revision, securityRepoStatus) {
  return {
    sha: revision,
    lastModified,
    securityRepoStatus,
  };
}

test('builds a security-status URL for an exact model revision', () => {
  assert.equal(
    modelAuditUrl('owner/model name', 'refs/pr/1'),
    'https://huggingface.co/api/models/owner/model%20name/revision/refs%2Fpr%2F1?securityStatus=true',
  );
});

test('audits pinned revisions in parallel and preserves manifest order', async () => {
  const requested = [];
  const models = [
    { id: 'org/first', revision: pinnedRevision },
    { id: 'org/second', revision: secondRevision },
  ];
  const results = await auditModels(models, {
    fetchImpl: async (url) => {
      requested.push(url);
      const revision = url.includes(secondRevision) ? secondRevision : pinnedRevision;
      return {
        ok: true,
        json: async () => hubResponse(revision, { scansDone: true, filesWithIssues: [] }),
      };
    },
  });

  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.endsWith('?securityStatus=true')));
  assert.deepEqual(results.map(({ id, status }) => ({ id, status })), [
    { id: 'org/first', status: 'clean' },
    { id: 'org/second', status: 'clean' },
  ]);
});

test('classifies unsafe, caution, and incomplete scans conservatively', async () => {
  const models = [
    { id: 'org/unsafe', revision: pinnedRevision },
    { id: 'org/caution', revision: pinnedRevision },
    { id: 'org/unscanned', revision: pinnedRevision },
  ];
  const results = await auditModels(models, {
    fetchImpl: async (url) => {
      const securityRepoStatus = url.includes('/unsafe/')
        ? {
            scansDone: true,
            filesWithIssues: [{ path: 'pytorch_model.bin', level: 'unsafe' }],
          }
        : url.includes('/caution/')
          ? {
              scansDone: true,
              filesWithIssues: [{ path: 'weights.pt', level: 'caution' }],
            }
          : { scansDone: false, filesWithIssues: [] };
      return {
        ok: true,
        json: async () => hubResponse(pinnedRevision, securityRepoStatus),
      };
    },
  });

  assert.deepEqual(results.map((model) => model.status), ['unsafe', 'caution', 'unscanned']);
  assert.equal(hasAuditProblems(results), true);
});

test('formats a clean audit with an npm-style summary', () => {
  const output = formatAuditResults([
    {
      id: 'org/model',
      revision: pinnedRevision,
      scannedRevision: pinnedRevision,
      scansDone: true,
      issues: [],
      status: 'clean',
    },
  ]);

  assert.equal(output, 'found 0 security issues');
});

test('formats findings and incomplete scans as a detailed report', () => {
  const output = formatAuditResults([
    {
      id: 'org/model',
      revision: pinnedRevision,
      scannedRevision: pinnedRevision,
      scansDone: true,
      issues: [
        { path: 'unsafe.bin', level: 'unsafe' },
        { path: 'review.pt', level: 'caution' },
      ],
      status: 'unsafe',
    },
    {
      id: 'org/pending',
      revision: secondRevision,
      scannedRevision: secondRevision,
      scansDone: false,
      issues: [],
      status: 'unscanned',
    },
  ]);

  assert.match(output, /^# hug-models audit report$/m);
  assert.match(output, /^org\/model$/m);
  assert.match(output, /^Severity: unsafe$/m);
  assert.match(output, /^Revision: a{40}$/m);
  assert.match(output, /^File: unsafe\.bin$/m);
  assert.match(
    output,
    new RegExp(`^https://huggingface\\.co/org/model/blob/${pinnedRevision}/unsafe\\.bin$`, 'm'),
  );
  assert.match(output, /^Severity: caution$/m);
  assert.match(output, /^File: review\.pt$/m);
  assert.match(output, /^org\/pending$/m);
  assert.match(output, /^Status: unscanned$/m);
  assert.match(output, /The Hub did not report its security scans as complete\./);
  assert.match(output, /2 security findings \(1 caution, 1 unsafe\), 1 unscanned model$/);
});

test('color does not change audit report content', () => {
  const results = [{
    id: 'org/model',
    revision: pinnedRevision,
    scannedRevision: pinnedRevision,
    scansDone: true,
    issues: [{ path: 'model.bin', level: 'unsafe' }],
    status: 'unsafe',
  }];
  const plain = formatAuditResults(results);
  const colored = formatAuditResults(results, { color: true });

  assert.match(colored, ansiPattern);
  assert.equal(colored.replace(ansiPattern, ''), plain);
});

test('formats stable audit JSON with full revisions and no color', () => {
  const output = formatAuditResultsJson([{
    id: 'org/model',
    revision: pinnedRevision,
    scannedRevision: pinnedRevision,
    scansDone: true,
    issues: [{ path: 'model.bin', level: 'caution' }],
    status: 'caution',
  }]);

  assert.deepEqual(JSON.parse(output), [{
    model: 'org/model',
    revision: pinnedRevision,
    scannedRevision: pinnedRevision,
    status: 'caution',
    scansDone: true,
    issues: [{ path: 'model.bin', level: 'caution' }],
  }]);
  assert.doesNotMatch(output, ansiPattern);
});

test('rejects malformed security status and mismatched pinned revisions', async () => {
  await assert.rejects(
    auditModels([{ id: 'org/model', revision: pinnedRevision }], {
      fetchImpl: async () => ({
        ok: true,
        json: async () => hubResponse(pinnedRevision, { scansDone: true }),
      }),
    }),
    /invalid security status response/,
  );

  await assert.rejects(
    auditModels([{ id: 'org/model', revision: pinnedRevision }], {
      fetchImpl: async () => ({
        ok: true,
        json: async () => hubResponse(secondRevision, {
          scansDone: true,
          filesWithIssues: [],
        }),
      }),
    }),
    /Hub response resolved to b{40}/,
  );
});

test('CLI exits with zero for a completed clean audit', async () => {
  let output = '';
  const code = await runCli(['audit'], {
    readFileImpl: async () => JSON.stringify({
      models: [{ id: 'org/model', revision: pinnedRevision }],
    }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => hubResponse(pinnedRevision, {
        scansDone: true,
        filesWithIssues: [],
      }),
    }),
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 0);
  assert.equal(output, 'found 0 security issues');
});

test('CLI honors --no-color and exits with one for a security finding', async () => {
  let output = '';
  const code = await runCli(['audit', '--no-color'], {
    color: true,
    readFileImpl: async () => JSON.stringify({
      models: [{ id: 'org/model', revision: pinnedRevision }],
    }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => hubResponse(pinnedRevision, {
        scansDone: true,
        filesWithIssues: [{ path: 'model.bin', level: 'unsafe' }],
      }),
    }),
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 1);
  assert.match(output, /^org\/model$/m);
  assert.match(output, /^Severity: unsafe$/m);
  assert.match(output, /^File: model\.bin$/m);
  assert.doesNotMatch(output, ansiPattern);
});

test('CLI supports uncolored JSON with a custom manifest path', async () => {
  let output = '';
  const code = await runCli(['audit', 'config/models.json', '--json'], {
    cwd: '/project',
    color: true,
    readFileImpl: async (path) => {
      assert.equal(path, '/project/config/models.json');
      return JSON.stringify({ models: [{ id: 'org/model', revision: pinnedRevision }] });
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => hubResponse(pinnedRevision, {
        scansDone: false,
        filesWithIssues: [],
      }),
    }),
    write: (value) => {
      output = value;
    },
  });

  assert.equal(code, 1);
  assert.equal(JSON.parse(output)[0].status, 'unscanned');
  assert.doesNotMatch(output, ansiPattern);
});
