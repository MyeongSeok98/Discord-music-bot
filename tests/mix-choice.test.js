const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { chooseMixRequest } = require('../musicdata/functions/mix-choice');
const url = 'https://www.youtube.com/watch?v=IeyCdm9WwXM&list=RDIeyCdm9WwXM&start_radio=1';
const tick = () => new Promise(resolve => setImmediate(resolve));

function ui(type = 'command') {
  let prompt, options, waiter;
  const edits = [], replies = [], timeouts = [];
  const collector = new EventEmitter();
  collector.stop = reason => { if (collector.ended) return; collector.ended = true; collector.emit('end', [], reason); };
  const message = {
    edit: async data => { edits.push(data); return message; },
    delete: async () => {},
    createMessageComponentCollector: opts => { options = opts; return collector; }
  };
  const show = async data => { prompt = data; return message; };
  const interaction = { user: { id: 'owner' }, author: { id: 'owner' }, editReply: show, channel: { send: show } };
  const result = chooseMixRequest(interaction, url, type);
  async function click(index, { user = 'owner', value } = {}) {
    await tick();
    const modal = { resolve: submit => {
      assert.equal(waiter.filter(submit), true);
      const resolve = waiter.resolve; waiter = null; resolve(submit);
    } };
    const button = {
      customId: prompt.components[0].components[index].customId,
      user: { id: user }, deferUpdate: async () => {},
      reply: async data => replies.push(data),
      showModal: async data => { button.modal = data; },
      awaitModalSubmit: ({ filter, time }) => new Promise(resolve => { timeouts.push(time); waiter = { filter, resolve }; })
    };
    if (options.filter(button)) collector.emit('collect', button);
    await tick();
    if (value !== undefined) {
      modal.resolve({ user: { id: user }, customId: button.modal.customId,
        fields: { getTextInputValue: () => value }, deferUpdate: async () => {},
        reply: async data => replies.push(data) });
      await tick();
    }
    return { button, modal };
  }
  return { result, click, collector, edits, replies, timeouts };
}

test('single-song button strips playlist parameters in both entry points', async () => {
  for (const type of ['command', 'player']) {
    const session = ui(type); await session.click(0);
    const choice = await session.result;
    assert.equal(choice.text, 'https://www.youtube.com/watch?v=IeyCdm9WwXM');
    assert.equal(choice.mixCount, undefined);
    assert.equal(session.collector.ended, true);
    assert.deepEqual(session.edits.at(-1).components, []);
  }
});

test('count modal accepts five and forwards the original mix with that count', async () => {
  const session = ui(); await session.click(1, { value: '5' });
  const choice = await session.result;
  assert.equal(choice.text, url);
  assert.equal(choice.mixCount, 5);
});

test('invalid count allows retry instead of enqueueing or ending the prompt', async () => {
  const session = ui();
  await session.click(1, { value: '11' });
  assert.notEqual(session.collector.ended, true);
  assert.equal(session.replies.at(-1).ephemeral, true);
  await session.click(1, { value: '10' });
  assert.equal((await session.result).mixCount, 10);
});

test('other users cannot select a song or open the count modal', async () => {
  const session = ui(); const { button } = await session.click(1, { user: 'other' });
  assert.equal(button.modal, undefined);
  assert.equal(session.replies.at(-1).ephemeral, true);
  assert.notEqual(session.collector.ended, true);
  await session.click(0); assert.ok(await session.result);
});

test('unanswered prompts expire with no selected request', async () => {
  const session = ui(); await tick(); session.collector.stop('time');
  assert.equal(await session.result, null);
  assert.deepEqual(session.edits.at(-1).components, []);
});

test('modal submission arriving after expiry cannot select any tracks', async () => {
  const session = ui(); const { button, modal } = await session.click(1);
  session.collector.stop('time'); assert.equal(await session.result, null);
  modal.resolve({ user: { id: 'owner' }, customId: button.modal.customId,
    fields: { getTextInputValue: () => '5' }, reply: async data => session.replies.push(data) });
  await tick();
  assert.equal(session.replies.at(-1).ephemeral, true);
});

test('closing and reopening the input shares one waiter until the two-minute deadline', async () => {
  const session = ui();
  await session.click(1);
  assert.ok(session.timeouts[0] > 30000);
  await session.click(1, { value: '5' });
  assert.equal((await session.result).mixCount, 5);
  assert.equal(session.timeouts.length, 1);
});

test('single-song selection wins once even if an open modal is submitted later', async () => {
  const session = ui(); const { button, modal } = await session.click(1);
  await session.click(0);
  assert.equal((await session.result).text, 'https://www.youtube.com/watch?v=IeyCdm9WwXM');
  modal.resolve({ user: { id: 'owner' }, customId: button.modal.customId,
    fields: { getTextInputValue: () => '10' }, reply: async data => session.replies.push(data) });
  await tick();
  assert.equal(session.replies.at(-1).ephemeral, true);
});
