const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { TrackPrefetch, getNextTrack } = require('../musicdata/functions/prefetch');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const source = () => ({ stream: new PassThrough(), type: 'arbitrary' });

test('prefetched audio is opened once and ownership transfers to playback', async () => {
  const track = { url: 'https://youtu.be/one' };
  const audio = source(); let opens = 0;
  const cache = new TrackPrefetch(async () => { opens++; return audio; });
  await cache.prepare(track);
  await cache.prepare(track);
  assert.equal(await cache.take(track), audio);
  cache.cancel();
  assert.equal(opens, 1);
  assert.equal(audio.stream.destroyed, false);
  audio.stream.destroy();
});

test('replacing the next song aborts pending work and discards a late result', async () => {
  const pending = deferred(); let signal;
  const cache = new TrackPrefetch(async (url, options) => { signal = options.signal; return pending.promise; });
  const old = { url: 'https://youtu.be/old' };
  const waiting = cache.prepare(old);
  await Promise.resolve();
  cache.schedule({ url: 'https://youtu.be/new' }, 10000);
  assert.equal(signal.aborted, true);
  const audio = source(); pending.resolve(audio);
  await waiting;
  assert.equal(audio.stream.destroyed, true);
  assert.equal(await cache.take(old), null);
  cache.cancel();
});

test('expired and mismatched streams are destroyed instead of played', async () => {
  let now = 0;
  const audio = source(); const track = { url: 'https://youtu.be/one' };
  const cache = new TrackPrefetch(async () => audio, { now: () => now, ttlMs: 100 });
  await cache.prepare(track);
  now = 101;
  assert.equal(await cache.take(track), null);
  assert.equal(audio.stream.destroyed, true);
  const second = source();
  const other = new TrackPrefetch(async () => second);
  await other.prepare(track);
  assert.equal(await other.take({ url: 'https://youtu.be/two' }), null);
  assert.equal(second.stream.destroyed, true);
});

test('prefetch errors return a cache miss and do not reject in the background', async () => {
  const track = { url: 'https://youtu.be/private' };
  const cache = new TrackPrefetch(async () => { throw new Error('403'); });
  await cache.prepare(track);
  assert.equal(await cache.take(track), null);
});

test('scheduled preparation waits until its deadline and stop cancels it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let opens = 0;
  const audio = source(); const track = { url: 'https://youtu.be/next' };
  const cache = new TrackPrefetch(async () => { opens++; return audio; });
  cache.schedule(track, 20000);
  t.mock.timers.tick(19999);
  await Promise.resolve(); assert.equal(opens, 0);
  t.mock.timers.tick(1);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(opens, 1);
  await cache.prepare(track);
  cache.cancel(); assert.equal(audio.stream.destroyed, true);
  cache.schedule(track, 20000); cache.cancel();
  t.mock.timers.tick(20000); await Promise.resolve();
  assert.equal(opens, 1);
});

test('next-track selection respects repeat modes and empty queues', () => {
  const a = { url: 'a' }, b = { url: 'b' };
  assert.equal(getNextTrack([a, b], 0), b);
  assert.equal(getNextTrack([a, b], 1), a);
  assert.equal(getNextTrack([a], 2), a);
  assert.equal(getNextTrack([a], 0), null);
  assert.equal(getNextTrack([], 2), null);
});
