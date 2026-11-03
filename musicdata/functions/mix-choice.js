const { randomUUID } = require('node:crypto');
const { MessageActionRow, MessageButton, Modal, TextInputComponent } = require('discord.js');
const { parsePlaylistRequest } = require('./youtube');

async function chooseMixRequest(interaction, text, requestType) {
  const mix = parsePlaylistRequest(text);
  if (!mix?.isMix) return { text };
  const owner = interaction.user?.id || interaction.author?.id || interaction.member?.user?.id;
  if (!owner) throw new Error('믹스 요청자를 확인할 수 없다냐.');
  const token = `mix:${randomUUID()}`;
  const singleId = `${token}:single`, countId = `${token}:count`;
  const row = new MessageActionRow().addComponents(
    new MessageButton().setCustomId(singleId).setLabel('이 곡만 추가').setStyle('PRIMARY'),
    new MessageButton().setCustomId(countId).setLabel('곡 수 직접 입력').setStyle('SECONDARY')
  );
  const data = { content: '이 믹스를 어떻게 추가할까냐? 직접 입력은 1~10곡까지 가능하다냐. (2분 안에 선택)', components: [row] };
  const message = requestType === 'command'
    ? await interaction.editReply(data) : await interaction.channel.send(data);
  const deadline = Date.now() + 120000;
  const collector = message.createMessageComponentCollector({
    componentType: 'BUTTON', time: 120000,
    filter: button => [singleId, countId].includes(button.customId)
  });
  return new Promise(resolve => {
    let finished = false, busy = false, modalWaiting = false;
    async function finish(choice, content) {
      if (finished) return;
      finished = true;
      collector.stop(choice ? 'selected' : 'cancelled');
      try { await message.edit({ content, components: [] }); } catch { /* Prompt may have been deleted. */ }
      if (requestType === 'player') {
        const cleanup = setTimeout(() => message.delete().catch(() => {}), 5000);
        cleanup.unref?.();
      }
      resolve(choice);
    }
    async function handle(button) {
      if (finished) return button.reply({ content: '이미 끝난 선택이다냐. 링크를 다시 입력하라냐.', ephemeral: true });
      if (button.user.id !== owner) return button.reply({ content: '이 링크를 요청한 사람만 선택할 수 있다냐.', ephemeral: true });
      if (busy) return button.reply({ content: '선택을 처리중이다냐. 입력창에서 곡 수를 입력해 주라냐.', ephemeral: true });
      busy = true;
      let ownsModalWaiter = false;
      try {
        if (button.customId === singleId) {
          await button.deferUpdate();
          return await finish({ text: `https://www.youtube.com/watch?v=${mix.videoId}` }, '선택한 곡 한 개를 추가한다냐.');
        }
        // Reopening a closed input uses the same prompt-scoped modal ID and
        // one waiter, so older windows cannot enqueue a second request.
        const modalId = `${token}:input`;
        const modal = new Modal().setCustomId(modalId).setTitle('믹스에서 추가할 곡 수')
          .addComponents(new MessageActionRow().addComponents(
            new TextInputComponent().setCustomId('mix_count').setLabel('추가할 곡 수 (1~10)')
              .setStyle('SHORT').setPlaceholder('예: 5').setRequired(true).setMinLength(1).setMaxLength(2)
          ));
        await button.showModal(modal);
        busy = false;
        if (finished || modalWaiting) return;
        modalWaiting = true;
        ownsModalWaiter = true;
        while (!finished) {
          const submit = await button.awaitModalSubmit({
            time: Math.max(1, deadline - Date.now()),
            filter: value => value.customId === modalId && value.user.id === owner
          });
          if (finished) return submit.reply({ content: '이미 끝났거나 만료된 선택이다냐. 링크를 다시 입력해 달라냐.', ephemeral: true });
          const value = submit.fields.getTextInputValue('mix_count').trim();
          const count = /^\d{1,2}$/.test(value) ? Number(value) : NaN;
          if (!Number.isInteger(count) || count < 1 || count > 10) {
            await submit.reply({ content: '1~10 사이의 정수를 입력해 달라냐. 곡 수 직접 입력 버튼으로 다시 시도할 수 있다냐.', ephemeral: true });
            continue;
          }
          await submit.deferUpdate();
          await finish({ text, mixCount: count }, `믹스에서 최대 ${count}곡을 추가한다냐.`);
        }
      } catch (error) {
        if (error.code !== 'INTERACTION_COLLECTOR_ERROR') console.error('[mix choice]', error);
        if (!button.replied && !button.deferred && !finished) {
          await button.reply({ content: '선택을 처리하지 못했다냐. 버튼을 다시 눌러달라냐. 냐는 잘못한게 없다냐.', ephemeral: true }).catch(() => {});
        }
      } finally {
        busy = false;
        if (ownsModalWaiter) modalWaiting = false;
      }
    }
    collector.on('collect', button => { handle(button).catch(error => console.error('[mix choice]', error)); });
    collector.on('end', () => { finish(null, '선택이 취소되거나 시간이 만료되었다냐. 링크를 다시 입력해달라냐. 냐는 잘못한게 없다냐.'); });
  });
}

module.exports = { chooseMixRequest };
