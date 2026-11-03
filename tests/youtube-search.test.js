const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createYoutube } = require('../musicdata/functions/youtube');

test('title search skips malformed, banned, live and overlong entries and uses the final valid result', async () => {
  let calls = 0;
  const youtube = createYoutube({ extract: async () => {
    calls++;
    return { entries: [null, { title: 'No ID' },
      { id: 'aaaaaaaaaaa', title: 'BANNED remix', duration: 90 },
      { id: 'bbbbbbbbbbb', title: 'Long mix', duration: 3600 },
      { id: 'ccccccccccc', title: 'Live radio', duration: 100, live_status: 'is_live' },
      { id: 'aRiVUVNUhIs', title: 'Wanted song', duration: 190, channel: 'Artist', channel_url: 'https://www.youtube.com/channel/test' }
    ] };
  } });
  const result = await youtube.search('song title', { durationLimit: 200, banKeywords: ['banned'] });
  assert.equal(result.videoDetails.videoId, 'aRiVUVNUhIs');
  assert.equal(result.videoDetails.lengthSeconds, '190');
  assert.equal(result.videoDetails.author.name, 'Artist');
  assert.equal(calls, 1, 'complete flat metadata does not need another extraction');
});

test('banned words still apply when the duration limit is disabled', async () => {
  const youtube = createYoutube({ extract: async () => ({ entries: [
    { id: 'aaaaaaaaaaa', title: 'Banned remix', duration: 90 },
    { id: 'bbbbbbbbbbb', title: 'Allowed song', duration: 900 }
  ] }) });
  const result = await youtube.search('song', { durationLimit: 0, banKeywords: ['banned'] });
  assert.equal(result.videoDetails.title, 'Allowed song');
});

test('missing duration is verified before enforcing the configured length limit', async () => {
  const youtube = createYoutube({ extract: async url => url.startsWith('ytsearch')
    ? { entries: [{ id: 'aaaaaaaaaaa', title: 'Unknown length' }, { id: 'bbbbbbbbbbb', title: 'Short song', duration: 60 }] }
    : { id: 'aaaaaaaaaaa', title: 'Unknown length', duration: 900 } });
  const result = await youtube.search('song', { durationLimit: 180 });
  assert.equal(result.videoDetails.videoId, 'bbbbbbbbbbb');
});

test('unavailable candidates do not prevent a later search result from being selected', async () => {
  const youtube = createYoutube({ extract: async url => {
    if (!url.startsWith('ytsearch')) throw new Error('Video unavailable');
    return { entries: [{ id: 'aaaaaaaaaaa', title: 'Unavailable' }, { id: 'bbbbbbbbbbb', title: 'Available', duration: 60 }] };
  } });
  const result = await youtube.search('song');
  assert.equal(result.videoDetails.title, 'Available');
});

test('empty or missing entries return no result instead of dereferencing a missing filter', async () => {
  for (const response of [{ entries: [] }, {}, null]) {
    const youtube = createYoutube({ extract: async () => response });
    assert.equal(await youtube.search('not found'), null);
  }
});

test('search network failures propagate to the caller for an error response', async () => {
  const youtube = createYoutube({ extract: async () => { throw new Error('Network timeout'); } });
  await assert.rejects(youtube.search('song'), /Network timeout/);
});
