const { SlashCommandBuilder } = require('@discordjs/builders');
const { parsePlaylistRequest } = require('../../musicdata/functions/youtube.js');
const { streamTrigger } = require('../../musicdata/functions/stream.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mix')
    .setDescription('YouTube 믹스에서 최대 10곡을 바로 추가한다냐.')
    .addStringOption(option => option.setName('request')
      .setDescription('YouTube 믹스(RD) 링크를 입력하라냐')
      .setRequired(true)),
  async execute(interaction) {
    await interaction.deferReply();
    const text = interaction.options.getString('request').trim();
    if (!parsePlaylistRequest(text)?.isMix) {
      return interaction.editReply('YouTube 믹스 링크(list=RD...)를 입력해달라냐. 일반 곡은 /play로 추가할 수 있다냐.');
    }
    return streamTrigger(interaction, text, 'command', { allowMix: true });
  }
};
