const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { waitForVoiceReady } = require('../musicdata/functions/voiceconnection');

test('waits for actual voice Ready rather than channel membership', async () => {
  const connection = new EventEmitter();
  connection.state = { status: 'connecting' };
  let ready = false;
  const waiting = waitForVoiceReady(connection, 1000).then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  const old = connection.state;
  connection.state = { status: 'ready' };
  connection.emit('stateChange', old, connection.state);
  connection.emit('ready', old, connection.state);
  await waiting;
  assert.equal(ready, true);
});

test('failed voice handshake rejects and destroys the stuck connection', async () => {
  const connection = new EventEmitter();
  connection.state = { status: 'connecting' };
  let destroyed = false;
  connection.destroy = () => { destroyed = true; connection.state = { status: 'destroyed' }; };
  await assert.rejects(waitForVoiceReady(connection, 20), /음성 연결/);
  assert.equal(destroyed, true);
});
