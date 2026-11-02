const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
process.env.DOTENV_CONFIG_QUIET = 'true';
const { musicFunctions } = require('../musicdata/structures/musicServerInfo');
const { TrackPrefetch } = require('../musicdata/functions/prefetch');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const audio = () => ({ stream: new PassThrough(), type: 'arbitrary' });
const song = id => ({ title: id, url: `https://youtu.be/${id}`, duration: '00:05', author: { thumbnail: 'https://example.com/avatar.png' } });

// Replace only external Discord/YouTube IO; execute the actual orchestration,
// queue lifecycle, prefetch cache and connection readiness code together.
function harness({ lookup = async text => song(text), open = async () => audio() } = {}) {
  const players = [], calls = [], errors = [];
  const guild = { id: 'test', members: { me: { voice: { channel: null } } }, voiceAdapterCreator: {} };
  const server = new musicFunctions(guild);
  const connection = new EventEmitter();
  connection.joinConfig = { channelId: 'voice' };
  connection.state = { status: 'connecting' };
  connection.set = status => {
    const old = connection.state; connection.state = { status };
    connection.emit('stateChange', old, connection.state); connection.emit(status, old, connection.state);
  };
  connection.destroy = () => connection.set('destroyed');
  connection.subscribe = player => ({ player });
  const youtube = { stream: async (url, options) => { calls.push(url); return open(url, options); } };
  server.streamInfo.prefetch = new TrackPrefetch(youtube.stream);
  class Interaction {}
  const interaction = Object.assign(new Interaction(), {
    guild, member: { voice: { channel: { id: 'voice' } } },
    channel: { id: 'text', send: async () => {} },
    isCommand: () => true, editReply: async () => {}
  });
  const voice = require('@discordjs/voice');
  const dependencies = {
    '../structures/musicServerInfo.js': { serverInfoList: new Map([['test', server]]) },
    '@discordjs/voice': { ...voice,
      joinVoiceChannel: () => connection,
      createAudioPlayer: () => {
        const player = new EventEmitter(); player.state = { status: 'idle' };
        player.set = status => {
          const old = player.state; player.state = { ...player.state, status };
          player.emit('stateChange', old, player.state); player.emit(status, old, player.state);
        };
        player.play = resource => { player.state.resource = resource; player.set('playing'); };
        player.pause = () => { player.set('paused'); return true; };
        player.unpause = () => { player.set('playing'); return true; };
        player.stop = () => { if (player.state.status === 'idle') return false; player.state.resource?.playStream.destroy(); player.set('idle'); return true; };
        players.push(player); return player;
      },
      createAudioResource: stream => ({ playStream: stream, playbackDuration: 0, volume: { setVolume() {} } })
    },
    'discord.js': { Interaction },
    './pushqueue.js': {
      resolveRequest: (i, text) => lookup(text),
      pushqueue: async (i, text, resolved) => { server.queue.push(resolved); server.queueChanged(); return { content: 'queued' }; }
    },
    './youtube.js': youtube,
    './updateplayer.js': { getPlayerEmbed: () => ({ content: 'player' }) },
    './search.js': { ytsearchGetInfo: async () => 5, ytRelatedGetInfo: async () => 5 }
  };
  const filename = path.resolve('musicdata/functions/stream.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const bootstrap = "String.prototype.interpolate = function(params) { return this.replace(/\\$\\{(\\w+)\\}/g, (_, key) => params[key]); };\n";
  vm.runInNewContext(bootstrap + fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, AbortController, setTimeout, clearTimeout,
    require: name => dependencies[name] || realRequire(name),
    console: { log() {}, error: (...args) => errors.push(args) }
  }, { filename });
  return { server, connection, calls, players, errors, interaction,
    play: text => module.exports.streamTrigger(interaction, text, 'command'),
    cleanup: () => { if (connection.state.status === 'connecting') connection.set('ready'); server.enterstop(); }
  };
}

test('real request pipeline overlaps lookup with voice and only queues after Ready', async t => {
  const lookup = deferred(); let started = false;
  const h = harness({ lookup: () => { started = true; return lookup.promise; } }); t.after(h.cleanup);
  const task = h.play('one'); await tick();
  assert.equal(started, true);
  lookup.resolve(song('one')); await tick();
  assert.equal(h.server.queue.length, 0);
  h.connection.set('ready'); await task;
  assert.deepEqual(h.errors, []);
  assert.equal(h.server.queue[0].title, 'one');
  assert.equal(h.players[0].state.status, 'playing');
});

test('lookup failure rolls back only a newly created unused connection', async t => {
  const h = harness({ lookup: async () => 2 }); t.after(h.cleanup);
  const task = h.play('bad'); await tick(); h.connection.set('ready'); await task;
  assert.equal(h.server.queue.length, 0);
  assert.equal(h.connection.state.status, 'destroyed');
  assert.equal(h.calls.length, 0);
});

test('stop during lookup prevents a late result from resurrecting playback', async t => {
  const lookup = deferred(); const h = harness({ lookup: () => lookup.promise }); t.after(h.cleanup);
  const task = h.play('one'); await tick();
  await h.server.stop();
  h.connection.set('ready'); lookup.resolve(song('one')); await task;
  assert.equal(h.server.queue.length, 0);
  assert.equal(h.calls.length, 0);
});

test('the next track uses its prepared source without a second extraction', async t => {
  const sources = [];
  const h = harness({ open: async () => { const s = audio(); sources.push(s); return s; } }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await first;
  await h.play('two');
  await h.server.streamInfo.prefetch.prepare(h.server.queue[1]);
  h.players[0].stop(); await tick();
  assert.equal(h.server.queue[0].title, 'two');
  assert.equal(h.server.streamInfo.audioResource.playStream, sources[1].stream);
  assert.equal(h.calls.length, 2);
});

test('skip during a slow foreground download cannot play the old song later', async t => {
  const slow = deferred(); const h = harness({ open: url => url.endsWith('/one') ? slow.promise : Promise.resolve(audio()) }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await tick();
  await h.play('two');
  await h.server.skip();
  const stale = audio(); slow.resolve(stale); await first;
  assert.equal(h.server.queue[0].title, 'two');
  assert.equal(h.server.previousqueue[0].title, 'two');
  assert.equal(stale.stream.destroyed, true);
});

test('moving an upcoming song while the first download is pending preserves current playback', async t => {
  const slow = deferred();
  const h = harness({ open: url => url.endsWith('/one') ? slow.promise : Promise.resolve(audio()) }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await tick();
  await h.play('two'); await h.play('three');
  h.server.move(1, 2);
  const currentAudio = audio(); slow.resolve(currentAudio); await first;
  assert.equal(h.players[0].state.status, 'playing');
  assert.equal(h.server.previousqueue[0].title, 'one');
  assert.equal(currentAudio.stream.destroyed, false);
});

test('one failed lookup cannot disconnect another concurrent successful request', async t => {
  const bad = deferred(), good = deferred();
  const h = harness({ lookup: text => text === 'bad' ? bad.promise : good.promise }); t.after(h.cleanup);
  const first = h.play('bad'), second = h.play('good'); await tick(); h.connection.set('ready');
  bad.resolve(2); await first;
  assert.equal(h.connection.state.status, 'ready');
  good.resolve(song('good')); await second;
  assert.equal(h.server.queue[0].title, 'good');
});

test('a failed request retains a previously established idle connection', async t => {
  const h = harness({ lookup: async text => text === 'bad' ? 2 : song(text) }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await first;
  await h.server.stop();
  await h.play('bad');
  assert.equal(h.server.queue.length, 0);
  assert.equal(h.connection.state.status, 'ready');
});

test('stopping during a track transition allows a later request to start a new player', async t => {
  const slow = deferred();
  const h = harness({ open: url => url.endsWith('/two') ? slow.promise : Promise.resolve(audio()) }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await first;
  await h.play('two');
  h.players[0].stop(); await tick();
  await h.server.stop();
  const stale = audio(); slow.resolve(stale); await tick();
  await h.play('three');
  assert.ok(h.calls.some(url => url.endsWith('/three')));
  assert.equal(h.server.streamInfo.audioPlayer.state.status, 'playing');
  assert.equal(stale.stream.destroyed, true);
});

test('pause frees prepared audio and resume can prepare a fresh source', async t => {
  const sources = [];
  const h = harness({ open: async () => { const s = audio(); sources.push(s); return s; } }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await first;
  await h.play('two'); await h.server.streamInfo.prefetch.prepare(h.server.queue[1]);
  h.server.pause(); assert.equal(sources[1].stream.destroyed, true);
  h.server.pause(); await h.server.streamInfo.prefetch.prepare(h.server.queue[1]);
  assert.equal(h.calls.length, 3);
  assert.equal(sources[2].stream.destroyed, false);
});

test('deleting the prepared next song cancels it and playback advances to the replacement', async t => {
  const sources = [];
  const h = harness({ open: async () => { const s = audio(); sources.push(s); return s; } }); t.after(h.cleanup);
  const first = h.play('one'); await tick(); h.connection.set('ready'); await first;
  await h.play('two'); await h.play('three');
  await h.server.streamInfo.prefetch.prepare(h.server.queue[1]);
  h.server.remove(1);
  assert.equal(sources[1].stream.destroyed, true);
  await h.server.streamInfo.prefetch.prepare(h.server.queue[1]);
  h.players[0].stop(); await tick();
  assert.equal(h.server.queue[0].title, 'three');
  assert.equal(h.server.streamInfo.audioResource.playStream, sources[2].stream);
});

test('another voice channel cannot enqueue during the first channel handshake', async t => {
  const h = harness(); t.after(h.cleanup);
  const first = h.play('one'); await tick();
  h.interaction.member.voice.channel = { id: 'different-channel' };
  await h.play('two');
  h.connection.set('ready'); await first;
  assert.equal(h.server.queue.length, 1);
  assert.equal(h.server.queue[0].title, 'one');
});
