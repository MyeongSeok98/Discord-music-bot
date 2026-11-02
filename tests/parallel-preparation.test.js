const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareInParallel } = require('../musicdata/functions/parallel-preparation');

test('voice and lookup start together but results are published only when both finish', async () => {
  let finishVoice, finishLookup;
  const started = [];
  let finished = false;
  const task = prepareInParallel(
    () => { started.push('voice'); return new Promise(r => { finishVoice = r; }); },
    () => { started.push('lookup'); return new Promise(r => { finishLookup = r; }); }
  ).then(result => { finished = true; return result; });
  await Promise.resolve();
  assert.deepEqual(started, ['voice', 'lookup']);
  finishLookup({ title: 'song' });
  await Promise.resolve(); assert.equal(finished, false);
  finishVoice('ready');
  assert.deepEqual(await task, { connection: 'ready', request: { title: 'song' } });
});

test('failed voice preparation cannot publish a successful lookup', async () => {
  await assert.rejects(prepareInParallel(
    async () => { throw new Error('voice failed'); }, async () => ({ title: 'song' })
  ), /voice failed/);
});
