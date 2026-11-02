const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { parsePlaylistRequest } = require('../musicdata/functions/youtube');

function command() {
  const calls = [];
  const filename = path.resolve('commands/music/mix.js');
  const realRequire = createRequire(filename), module = { exports: {} };
  const dependencies = {
    '../../musicdata/functions/youtube.js': { parsePlaylistRequest },
    '../../musicdata/functions/stream.js': { streamTrigger: async (...args) => { calls.push(args); } }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: name => dependencies[name] || realRequire(name)
  }, { filename });
  return { command: module.exports, calls };
}

test('/mix registers a required link and explicitly enables multi-track mix addition', async () => {
  const h = command(); const data = h.command.data.toJSON();
  assert.equal(data.name, 'mix');
  assert.equal(data.options[0].required, true);
  const interaction = { deferReply: async () => {}, options: { getString: () =>
    'https://www.youtube.com/watch?v=IeyCdm9WwXM&list=RDIeyCdm9WwXM' } };
  await h.command.execute(interaction);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][2], 'command');
  assert.equal(h.calls[0][3].allowMix, true);
});

test('/mix rejects ordinary videos and fixed playlists without starting preparation', async () => {
  const h = command(); let replies = 0;
  for (const text of ['song title', 'https://www.youtube.com/watch?v=IeyCdm9WwXM',
    'https://www.youtube.com/playlist?list=PL0BYnx8lSxXUlmQlhtwYT--1Kbql1OJA9']) {
    await h.command.execute({ deferReply: async () => {}, editReply: async () => { replies++; }, options: { getString: () => text } });
  }
  assert.equal(replies, 3);
  assert.equal(h.calls.length, 0);
});

test('/mix cannot bypass the configured music command channel restriction', async () => {
  const filename = path.resolve('events/interactionCreate.js');
  const module = { exports: {} };
  const server = { streamInfo: { commandChannel: 'allowed-channel' }, playerInfo: { channelId: 'player-channel' } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console,
    require: () => ({ serverInfoList: new Map([['guild', server]]) })
  }, { filename });
  let executed = false, denied = false;
  await module.exports.execute({ isCommand: () => true, commandName: 'mix',
    guild: { id: 'guild' }, channel: { id: 'other-channel' },
    reply: async message => { denied = message.ephemeral; }
  }, { commands: new Map([['mix', { data: { name: 'mix' }, execute: async () => { executed = true; } }]]) });
  assert.equal(executed, false);
  assert.equal(denied, true);
});
