const { SlashCommandBuilder } = require('@discordjs/builders');
const { serverInfoList } = require('../../musicdata/structures/musicServerInfo.js');
const { defaultMusicCommandScript } = require('../../script.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('volume')
		.setDescription('🔉 스트리밍 할 때의 볼륨을 바꾼다냐. 모두에게 지정되는 값이다냐')
		.addIntegerOption(option =>
			option
				.setName('volume')
				.setDescription('볼륨을 몇%로 설정할건지 1~100까지의 자연수를 써 달라냐')
				.setRequired(true)
		),
	async execute(interaction){
		await interaction.deferReply();
		const server = serverInfoList.get(interaction.guild.id);

		if(server.queue.length == 0 || !server.streamInfo.connection || !server.streamInfo.audioResource)
			return interaction.editReply(defaultMusicCommandScript.nothingPlay);

		if(interaction.member.voice.channel){
			if(!interaction.member.voice.channel.members.find(m => m.user.id == process.env.CLIENT_ID)) return interaction.editReply(defaultMusicCommandScript.existOtherVc);
		}else{
			return interaction.editReply(defaultMusicCommandScript.firstJoinVc);
		}
				

		await server.volume(interaction.options.getInteger('volume')) ? 
			interaction.editReply(defaultMusicCommandScript.volset.interpolate({
				size: `${interaction.options.getInteger('volume')}`
			})) :
			interaction.editReply(defaultMusicCommandScript.volRangeWarn);
		return;
	}
}
