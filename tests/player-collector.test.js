const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

async function collectors() {
  const messages = new EventEmitter(), buttons = new EventEmitter(), timers = [];
  let id = 0;
  const channel = {
    bulkDelete: async () => {}, send: async () => ({ id: String(++id), edit: async () => {} }),
    createMessageCollector: () => messages, createMessageComponentCollector: () => buttons
  };
  const server = {
    guild: { channels: { fetch: async () => channel } }, queue: [],
    playerInfo: { channelId: 'channel', playermsg: {
      banner: { messageContent: 'default', imageURL: ['banner.png'] }, embed: {}
    } }
  };
  const filename = path.resolve('musicdata/functions/syncplayer.js');
  const realRequire = createRequire(filename);
  const dependencies = {
    mongoose: {}, dotenv: { config() {} },
    '../structures/musicServerInfo.js': { serverInfoList: new Map([['guild', server]]) },
    './updateplayer.js': { getPlayerEmbed: () => ({ content: 'player', embeds: [] }) }
  };
  const module = { exports: {} };
  vmRun();
  function vmRun() {
    require('node:vm').runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, console,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
      require: name => dependencies[name] || realRequire(name)
    }, { filename });
  }
  await module.exports.syncPlayerChannel('guild');
  return { messages, buttons, timers };
}

test('a player channel does not delete an active mix selection prompt after five seconds', async () => {
  const h = await collectors();
  h.messages.emit('collect', {
    type: 'DEFAULT', author: { bot: true }, member: { user: { bot: true } },
    components: [{ components: [{ customId: 'mix:session:single' }] }], delete: async () => {}
  });
  assert.equal(h.timers.length, 0);
});

test('the player button collector never acknowledges a mix selection button', async () => {
  const h = await collectors(); let acknowledged = false;
  h.buttons.emit('collect', {
    isButton: () => true, customId: 'mix:session:count', member: { voice: { channel: {} } },
    update: async () => { acknowledged = true; }
  });
  assert.equal(acknowledged, false);
});
