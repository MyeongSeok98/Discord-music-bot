const { SlashCommandBuilder } = require('@discordjs/builders');
const { serverInfoList } = require('../../musicdata/structures/musicServerInfo.js');
const { defaultMusicCommandScript } = require('../../script.json');
const {
	MessageEmbed,
	MessageButton,
	MessageActionRow
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('loop')
		.setDescription('🔁 반복 모드를 설정한다냐'),
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
				
		if(interaction.channel.id == server.playerInfo.playerChannelId) 
			return interaction.channel.send(defaultMusicCommandScript.loopwarn);
		return await loopMessage(interaction, server);
	}
}

async function loopMessage(interaction, server){
	const selectmodeEmbed = new MessageEmbed()
		.setTitle('반복 모드를 선택해달라냐')
		.setDescription(`현재 **${server.playInfo.loopmode[server.playInfo.loopcode]}**`)
		.addFields({
			name: '🔂 싱글 루프 모드',
			value: defaultMusicCommandScript.loopsingledes,
			inline: false,
		})
		.addFields({
			name: '🔁 대기열 반복 모드',
			value: defaultMusicCommandScript.loopqueuedes,
			inline: false,
		})
		.addFields({
			name: '♾️ 자동 재생 모드',
			value: defaultMusicCommandScript.loopautodes,
			inline: false,
		})
		.setFooter({text: defaultMusicCommandScript.loopoffdes})
		.setColor(process.env.DEFAULT_COLOR);

	const selecbuttons = new MessageActionRow().addComponents(
		new MessageButton()
			.setCustomId('single')
			.setEmoji('🔂')
			.setStyle('SECONDARY'),
		new MessageButton()
			.setCustomId('queue')
			.setEmoji('🔁')
			.setStyle('SECONDARY'),
		new MessageButton()
			.setCustomId('autoplay')
			.setEmoji('♾️')
			.setStyle('SECONDARY'),
		new MessageButton()
			.setCustomId('off')
			.setLabel('끄기')
			.setStyle('SECONDARY')
			.setDisabled(true),
	);
	
	if(server.playInfo.loopcode == 0){
		selecbuttons.components[0].disabled = false;
		selecbuttons.components[1].disabled = false;
		selecbuttons.components[2].disabled = false;
		selecbuttons.components[3].disabled = true;
	}else{
		if(server.playInfo.loopcode == 1){
			selecbuttons.components[0].disabled = true;
			selecbuttons.components[1].disabled = false;
			selecbuttons.components[2].disabled = false;
			selecbuttons.components[3].disabled = false;
		}else if(server.playInfo.loopcode == 2){
			selecbuttons.components[0].disabled = false;
			selecbuttons.components[1].disabled = true;
			selecbuttons.components[2].disabled = false;
			selecbuttons.components[3].disabled = false;
		}else if(server.playInfo.loopcode == 3){
			selecbuttons.components[0].disabled = false;
			selecbuttons.components[1].disabled = false;
			selecbuttons.components[2].disabled = true;
			selecbuttons.components[3].disabled = false;
		}
	}
	
	const modeMessage = await interaction.editReply({embeds: [selectmodeEmbed], components: [selecbuttons]});
	
	const filter = i => i.user.id == interaction.member.id && i.message?.id === modeMessage.id
		&& ['single', 'queue', 'autoplay', 'off'].includes(i.customId);
	const collector = interaction.channel.createMessageComponentCollector({filter, time: 300e3});

	collector.on('collect', async button => {
		switch(button.customId){
			case 'single':
				server.playInfo.loopcode = 1;
				break;

			case 'queue':
				server.playInfo.loopcode = 2;
				break;

			case 'autoplay':
				server.playInfo.loopcode = 3;
				break;

			case 'off':
				server.playInfo.loopcode = 0;
				break;
		}

		server.queueChanged();
		collector.stop();
		await interaction.deleteReply();
		server.playInfo.loopcode == 0 ?
			await interaction.channel.send({
				content: defaultMusicCommandScript.loopoffmsg
			}) :
			await interaction.channel.send({
				content: defaultMusicCommandScript.loopchmsg.interpolate({
					playmode: server.playInfo.loopmode[server.playInfo.loopcode]
				})
			});
		if(server.queue.length == 1 && server.playInfo.loopcode == 3){
			require('../../musicdata/functions/stream.js').autosearchPush(interaction, server);
		}
	});

}
