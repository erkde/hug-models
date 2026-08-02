import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigValidationError, createModelConfig } from '../src/index.js';

test('creates config and supplies model defaults', () => {
  const config = createModelConfig({
    models: [
      {
        id: 'Xenova/all-MiniLM-L6-v2',
        revision: 'abc123',
      },
    ],
  });

  assert.deepEqual(config.get(), {
    id: 'Xenova/all-MiniLM-L6-v2',
    revision: 'abc123',
    track: 'main',
  });
});

test('gets a named model from a multi-model manifest', () => {
  const config = createModelConfig({
    models: [
      { name: 'sentiment', id: 'org/sentiment', revision: 'abc123' },
      { name: 'embeddings', id: 'org/embeddings', revision: 'def456' },
    ],
  });

  assert.equal(config.get('embeddings').id, 'org/embeddings');
  assert.throws(() => config.get(), /model name is required/);
});

test('rejects duplicate names and malformed model definitions', () => {
  assert.throws(
    () => createModelConfig({
      models: [
        { name: 'model', id: 'org/one', revision: 'abc123' },
        { name: 'model', id: 'org/two', revision: 'def456' },
      ],
    }),
    ConfigValidationError,
  );

  assert.throws(
    () => createModelConfig({ models: [{ id: '', revision: 'abc123' }] }),
    /models\[0\]\.id/,
  );
  assert.throws(
    () => createModelConfig({ models: [{ id: 'org/model', revision: '' }] }),
    /revision must be a non-empty string/,
  );
});
