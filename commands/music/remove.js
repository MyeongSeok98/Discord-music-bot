const { SlashCommandBuilder } = require('@discordjs/builders');
const { serverInfoList } = require('../../musicdata/structures/musicServerInfo.js');
const { defaultMusicCommandScript } = require('../../script.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('remove')
		.setDescription('🗑️ 대기열의 노래를 하나만 지우거나 한꺼번에 지워요')
		.addIntegerOption(option =>
			option
				.setName('rmrange1')
				.setDescription('어떤 노래를 지울지 번호를 써 주세요')
				.setRequired(true)
		).addIntegerOption(option =>
			option
				.setName('rmrange2')
				.setDescription('어디까지 지울지 써 주세요')
				.setRequired(false)
		),
	async execute(interaction){

		await interaction.deferReply();
		const server = serverInfoList.get(interaction.guild.id);

		if(server.queue.length == 0 || !server.streamInfo.connection || !server.streamInfo.audioResource)
			return interaction.editReply(defaultMusicCommandScript.nothingPlay);

		if(interaction.member.voice.channel){
			if(!interaction.member.voice.channel.members.find(m => m.user.id == process.env.CLIENT_ID)) return interaction.reply(defaultMusicCommandScript.existOtherVc);
		}else{
			return interaction.reply(defaultMusicCommandScript.firstJoinVc);
		}
		
		let rmrange1 = interaction.options.getInteger('rmrange1');
		let rmrange2 = interaction.options.getInteger('rmrange2');
		if(rmrange2){
			[rmrange1, rmrange2] = rmrange1 <= rmrange2 ? 
				[rmrange1, rmrange2] : 
				[rmrange2, rmrange1];
		}

		server.queue.length == 1 ? interaction.editReply(defaultMusicCommandScript.rmWarn1)
			: rmrange1 < 1 ? interaction.editReply(defaultMusicCommandScript.rmWarn2)
			: !rmrange2 ? interaction.editReply(defaultMusicCommandScript.rmclear0.interpolate({
				target: `${interaction.options.getInteger('rmrange1')}`,
				title: `${server.queue[rmrange1].title}`
			}))
			: (rmrange1 == 1 && rmrange2 == server.queue.length - 1) ? interaction.editReply(defaultMusicCommandScript.rmclear1)
			: interaction.editReply({
				content: defaultMusicCommandScript.rmclear2.interpolate({
					target: `${interaction.options.getInteger('rmrange1')}`,
					endpt: `${interaction.options.getInteger('rmrange2')}`
				})
			});
		
		!rmrange2 ? 
			server.queue.splice(rmrange1, 1) :
			server.queue.splice(rmrange1, rmrange2 - rmrange1 + 1);
		server.queueChanged();

		return;
	}
}
