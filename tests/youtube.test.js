const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createYoutube } = require('../musicdata/functions/youtube');

test('video info preserves the queue contract without deciphering with ytdl-core', async () => {
  const youtube = createYoutube({ extract: async () => ({
    id: 'aRiVUVNUhIs', title: 'Test song', duration: 190,
    webpage_url: 'https://www.youtube.com/watch?v=aRiVUVNUhIs',
    channel: 'Test artist', channel_url: 'https://www.youtube.com/channel/test'
  }) });
  const { videoDetails: v } = await youtube.getInfo('https://www.youtube.com/watch?v=aRiVUVNUhIs');
  assert.equal(v.title, 'Test song');
  assert.equal(v.lengthSeconds, '190');
  assert.equal(v.author.name, 'Test artist');
  assert.equal(v.author.channel_url, 'https://www.youtube.com/channel/test');
  assert.ok(v.author.thumbnails[0].url.startsWith('https://'));
});

test('private or unavailable video errors are propagated rather than queued', async () => {
  const youtube = createYoutube({ extract: async () => { throw new Error('Video unavailable'); } });
  await assert.rejects(youtube.getInfo('https://youtu.be/aRiVUVNUhIs'), /Video unavailable/);
});

test('automatic selection excludes history, banned titles, and overlong tracks', async () => {
  const entries = {
    old: { id: 'old', title: 'Old song', duration: 30 },
    banned: { id: 'banned', title: 'BANNED song', duration: 30 },
    long: { id: 'long', title: 'Long song', duration: 600 },
    good: { id: 'good', title: 'Next song', duration: 120 }
  };
  const youtube = createYoutube({
    relatedInfo: async () => ({ related_videos: Object.keys(entries).map(id => `https://youtu.be/${id}`) }),
    extract: async url => entries[new URL(url).pathname.slice(1)]
  });
  const result = await youtube.getRelatedInfo('https://youtu.be/current',
    { banKeywords: ['banned'], durationLimit: 180 }, [{ url: 'https://www.youtube.com/watch?v=old' }]);
  assert.equal(result.videoDetails.videoId, 'good');
});

test('audio stream delivers bytes and destroys its downloader when skipped', async () => {
  let child;
  const youtube = createYoutube({ spawnProcess: () => {
    child = spawn(process.execPath, ['-e', 'process.stdout.write("audio");setInterval(()=>{},1000)'], { windowsHide: true });
    return child;
  } });
  const { stream } = await youtube.stream('https://youtu.be/aRiVUVNUhIs');
  assert.equal(stream.read().toString(), 'audio');
  const exited = new Promise(resolve => child.once('close', resolve));
  stream.destroy();
  await exited;
  assert.ok(child.killed);
});

test('downloader failure before audio arrives rejects promptly with its reason', async () => {
  const youtube = createYoutube({ spawnProcess: () => spawn(process.execPath,
    ['-e', 'process.stderr.write("HTTP Error 403");process.exit(1)'], { windowsHide: true }) });
  await assert.rejects(youtube.stream('https://youtu.be/aRiVUVNUhIs'), /HTTP Error 403/);
});

test('partial audio followed by downloader failure is not treated as a completed song', async () => {
  const youtube = createYoutube({ spawnProcess: () => spawn(process.execPath,
    ['-e', 'process.stdout.write("audio");setTimeout(()=>{process.stderr.write("HTTP Error 403");process.exit(1)},100)'],
    { windowsHide: true }) });
  const { stream } = await youtube.stream('https://youtu.be/aRiVUVNUhIs');
  await assert.rejects(async () => { for await (const chunk of stream) { /* consume audio */ } }, /HTTP Error 403/);
});

test('successful finite audio ends normally after the downloader exits', async () => {
  const youtube = createYoutube({ spawnProcess: () => spawn(process.execPath,
    ['-e', 'process.stdout.write("complete audio")'], { windowsHide: true }) });
  const { stream } = await youtube.stream('https://youtu.be/aRiVUVNUhIs');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'complete audio');
});

test('cancelling a pending audio download terminates its child process', async () => {
  let child;
  const youtube = createYoutube({ spawnProcess: () => {
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true });
    return child;
  } });
  const controller = new AbortController();
  const pending = youtube.stream('https://youtu.be/aRiVUVNUhIs', { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  if (child.exitCode === null) await new Promise(resolve => child.once('close', resolve));
  assert.equal(child.killed, true);
});

test('an already cancelled request does not start a downloader', async () => {
  const controller = new AbortController(); controller.abort();
  const youtube = createYoutube({ spawnProcess: () => { throw new Error('must not spawn'); } });
  await assert.rejects(youtube.stream('https://youtu.be/aRiVUVNUhIs', { signal: controller.signal }), { name: 'AbortError' });
});
