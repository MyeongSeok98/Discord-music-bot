const { SlashCommandBuilder } = require('@discordjs/builders');
const { serverInfoList } = require('../../musicdata/structures/musicServerInfo.js');
const { MessageEmbed } = require('discord.js');
const {
	totalSongDuration,
	getTimestamp
} = require('../../musicdata/structures/timestamp.js');
const { reactionpages } = require('../../musicdata/structures/reactionpages.js');
require('dotenv').config();
const { defaultMusicCommandScript } = require('../../script.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('q')
		.setDescription('📜 현재 대기 중인 노래의 목록을 보여준다냐'),
	async execute(interaction){
		await interaction.deferReply();
		
		const server = serverInfoList.get(interaction.guild.id);
		
		if(server.queue.length == 0 || !server.streamInfo.connection || !server.streamInfo.audioResource)
			return interaction.editReply(defaultMusicCommandScript.nothingPlay);

		const queue = server.queue;
		const sec = totalSongDuration(queue);
		const pages = [];

		let queueEmbed = new MessageEmbed()
			.setTitle(`대기 중인 노래 총 ${queue.length - 1}곡`)
			.setColor(process.env.DEFAULT_COLOR)
			.setDescription(
				`${server.playInfo.playStatus[server.playInfo.playStatusCode]} | ${server.playInfo.loopmode[server.playInfo.loopcode]}` + 
				` | 🔉: ${Math.round(server.playInfo.volume * 100)}% | 러닝타임: ${getTimestamp(sec)}`);

		for(let i = 0; i < queue.length; i++){
			let title = `#${i}. ${queue[i].title}`;
			if(i == 0){
				title = `#Playing>> ${queue[i].title}`;
				queueEmbed.addFields({
					name: title,
					value: `[${queue[i].duration}] | ${queue[i].url}\nrequested by ${queue[i].request.name}`,
					inline: false
				});
			}else{
				queueEmbed.addFields({
					name: title,
					value: `[${queue[i].duration}] | ${queue[i].url}`,
					inline: false
				});
			}

			if((i+1)%10 == 0){
				pages.push(queueEmbed);
				queueEmbed = new MessageEmbed()
				.setTitle(`대기 중인 노래 총 ${queue.length - 1}곡`)
				.setColor(process.env.DEFAULT_COLOR)
				.setDescription(
					`${server.playInfo.playStatus[server.playInfo.playStatusCode]} | ${server.playInfo.loopmode[server.playInfo.loopcode]}` + 
					` | 🔉: ${Math.round(server.playInfo.volume * 100)}% | 러닝타임: ${getTimestamp(sec)}`);
			}
		}
		if(queue.length % 10 != 0) pages.push(queueEmbed);
		await reactionpages(interaction, pages, true);
	}
}

