const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createYoutube, parsePlaylistRequest } = require('../musicdata/functions/youtube');

const list = 'PL0BYnx8lSxXUlmQlhtwYT--1Kbql1OJA9';
const entries = [
  { id: 'Y6Ybz_yjQ6U', title: 'First song', duration: 180, playlist_index: 1 },
  { id: 'mRgslQ5Z-kU', title: 'Second song', duration: 200, playlist_index: 2 },
  { id: '3DrYQMK4hJE', title: 'Third song', duration: 240, playlist_index: 3 }
];
const backend = values => createYoutube({ extract: async () => ({
  id: list, title: 'Tour', uploader: 'Owner', uploader_url: 'https://www.youtube.com/@owner', entries: values
}) });

test('watch links with and without index are classified as playlist requests', () => {
  for (const suffix of ['', '&index=3']) {
    assert.equal(parsePlaylistRequest(`https://www.youtube.com/watch?v=3DrYQMK4hJE&list=${list}${suffix}`).videoId, '3DrYQMK4hJE');
  }
  assert.equal(parsePlaylistRequest('https://www.youtube.com/watch?v=3DrYQMK4hJE'), null);
  assert.equal(parsePlaylistRequest(`https://notyoutube.com/playlist?list=${list}`), null);
});

test('a playlist-only link adds all tracks from the beginning', async () => {
  const result = await backend(entries).getPlaylist(`https://www.youtube.com/playlist?list=${list}`);
  assert.deepEqual(result.items.map(t => t.title), ['First song', 'Second song', 'Third song']);
  assert.equal(result.info.name, 'Tour');
  assert.equal(result.items[2].duration, '04:00');
  assert.equal(result.items[2].url, 'https://www.youtube.com/watch?v=3DrYQMK4hJE');
});

test('selected video with index starts at that video and preserves following order', async () => {
  const result = await backend(entries).getPlaylist(`https://www.youtube.com/watch?v=mRgslQ5Z-kU&list=${list}&index=2`);
  assert.deepEqual(result.items.map(t => t.title), ['Second song', 'Third song']);
});

test('selected video without index also starts at the selected video', async () => {
  const result = await backend(entries).getPlaylist(`https://youtu.be/mRgslQ5Z-kU?list=${list}`);
  assert.deepEqual(result.items.map(t => t.title), ['Second song', 'Third song']);
});

test('a stale index cannot override the selected video ID', async () => {
  const result = await backend(entries).getPlaylist(`https://www.youtube.com/watch?v=3DrYQMK4hJE&list=${list}&index=1`);
  assert.deepEqual(result.items.map(t => t.title), ['Third song']);
});

test('index disambiguates duplicate videos and unavailable entries do not shift selection', async () => {
  const repeated = [entries[0], { ...entries[1], availability: 'private' },
    { ...entries[0], playlist_index: 3 }, { ...entries[2], playlist_index: 4 }];
  const result = await backend(repeated).getPlaylist(`https://www.youtube.com/watch?v=Y6Ybz_yjQ6U&list=${list}&index=3`);
  assert.deepEqual(result.items.map(t => t.title), ['First song', 'Third song']);
});

test('missing selected video fails instead of silently playing from the beginning', async () => {
  await assert.rejects(backend(entries).getPlaylist(`https://www.youtube.com/watch?v=aaaaaaaaaaa&list=${list}`), /선택한 영상/);
});

test('empty lists and incomplete entries are handled without missing-author errors', async () => {
  const empty = await backend([]).getPlaylist(`https://www.youtube.com/playlist?list=${list}`);
  assert.equal(empty.items.length, 0);
  const result = await backend([null, { id: 'aaaaaaaaaaa', title: '[Private video]', availability: 'private' },
    { id: '3DrYQMK4hJE', title: 'No author or duration' }]).getPlaylist(`https://www.youtube.com/playlist?list=${list}`);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].author.name, 'YouTube');
  assert.equal(result.items[0].duration, '00:00');
});

test('radio mixes keep a watch URL and bound extraction and returned tracks to ten', async () => {
  let requestedUrl, requestedLimit;
  const mixEntries = Array.from({ length: 15 }, (_, i) => ({
    id: i === 0 ? 'IeyCdm9WwXM' : String(i).padStart(11, '0'),
    title: 'Mix song ' + (i + 1), duration: 180
  }));
  const youtube = createYoutube({ extract: async (url, options) => {
    requestedUrl = url; requestedLimit = options.playlistEnd;
    return { title: 'Mix', entries: mixEntries };
  } });
  const result = await youtube.getPlaylist('https://www.youtube.com/watch?v=IeyCdm9WwXM&list=RDIeyCdm9WwXM&start_radio=1');
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.pathname, '/watch');
  assert.equal(parsed.searchParams.get('v'), 'IeyCdm9WwXM');
  assert.equal(parsed.searchParams.get('list'), 'RDIeyCdm9WwXM');
  assert.equal(requestedLimit, 10);
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0].title, 'Mix song 1');
  assert.equal(result.items[9].title, 'Mix song 10');
});

test('ordinary playlists remain uncapped by the mix ten-track limit', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i).padStart(11, '0'), title: 'Song ' + i, duration: 180 }));
  const result = await backend(many).getPlaylist(`https://www.youtube.com/playlist?list=${list}`);
  assert.equal(result.items.length, 12);
});

test('mix extraction honors a user-selected count of five', async () => {
  let limit;
  const youtube = createYoutube({ extract: async (url, options) => {
    limit = options.playlistEnd;
    return { title: 'Mix', entries: Array.from({ length: 12 }, (_, i) => ({
      id: i === 0 ? 'IeyCdm9WwXM' : String(i).padStart(11, '0'), title: 'Song ' + i, duration: 180
    })) };
  } });
  const result = await youtube.getPlaylist('https://www.youtube.com/watch?v=IeyCdm9WwXM&list=RDIeyCdm9WwXM', { mixCount: 5 });
  assert.equal(result.items.length, 5);
  assert.equal(limit, 5);
});

test('invalid mix counts are rejected before fetching YouTube', async () => {
  const youtube = createYoutube({ extract: async () => { throw new Error('must not fetch'); } });
  for (const mixCount of [0, 11, 1.5, NaN, '5']) {
    await assert.rejects(youtube.getPlaylist('https://www.youtube.com/watch?v=IeyCdm9WwXM&list=RDIeyCdm9WwXM', { mixCount }), RangeError);
  }
});
