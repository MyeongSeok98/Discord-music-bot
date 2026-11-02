const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { parsePlaylistRequest } = require('../musicdata/functions/youtube');
process.env.DOTENV_CONFIG_QUIET = 'true';

test('the real request router sends both watch/list formats to playlist lookup without enqueueing', async () => {
  const filename = path.resolve('musicdata/functions/pushqueue.js');
  const realRequire = createRequire(filename);
  const queue = [];
  const playlist = { info: { name: 'Tour' }, items: [{ title: 'Selected' }, { title: 'Next' }] };
  const dependencies = {
    './youtube.js': { parsePlaylistRequest },
    './search.js': { ytplGetInfo: async () => playlist, yturlGetInfo: async () => ({ title: 'Single video' }) },
    '../structures/musicServerInfo.js': { serverInfoList: new Map([['guild', { queue, playInfo: { searchFilter: {} } }]]) }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: name => dependencies[name] || realRequire(name), console
  }, { filename });
  const interaction = { guild: { id: 'guild' } };
  for (const suffix of ['', '&index=3']) {
    const result = await module.exports.resolveRequest(interaction,
      'https://www.youtube.com/watch?v=3DrYQMK4hJE&list=PL0BYnx8lSxXUlmQlhtwYT--1Kbql1OJA9' + suffix);
    assert.equal(result.info.name, 'Tour');
    assert.equal(result.items.length, 2);
    assert.equal(queue.length, 0);
  }
  const single = await module.exports.resolveRequest(interaction, 'https://www.youtube.com/watch?v=3DrYQMK4hJE');
  assert.equal(single.title, 'Single video');
});
