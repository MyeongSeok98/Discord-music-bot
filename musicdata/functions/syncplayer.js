const mongoose = require('mongoose');
const { serverInfoList } = require('../structures/musicServerInfo.js');
const { getPlayerEmbed } = require('./updateplayer.js');
const wait = require('util').promisify(setTimeout);
const { AudioPlayerStatus } = require('@discordjs/voice');
const { MessageEmbed } = require('discord.js');
require('dotenv').config();

const defaultBannerMessage = `
**플레이어 사용법이다냐**
이 채널에 채팅으로 노래제목/링크/플레이리스트 링크를 치면 노래가 나온다냐.
고마우면 담배 달라냐.

**기본 기능**
⏯️ : 노래 일시정지 | 다시재생
⏹️ : 대기열만 초기화/노래 정지, 모든 상태(루프 등) 초기화/음성 채널 퇴장
⏭️ : 노래 스킵
⏳: 현재 타임라인 시간 보기

**고급 기능**
🔀 : 대기열 셔플 
🔂 : 싱글 루프 모드 활성화/비활성화 
🔁 : 대기열 반복 모드 활성화/비활성화 
♾️ : 자동 재생 모드 활성화/비활성화

**추가 기능**
🔈 : 볼륨 10% 감소 
🔊 : 볼륨 10% 증가 
❌ : 대기열 맨 마지막 노래 지우기 
⤴️ : 다음 곡을 대기열 맨 뒤로 옮기기 
⤵️ : 대기열 맨 마지막 노래를 맨 앞으로 옮기기
`;

const defaultButtonComponents = [
	{
		type: 'ACTION_ROW', //playpause | eject | stop | skip
		components: [
		{
			type: 'BUTTON',
			customId: 'playpause',
			emoji: '⏯️',
			style: 'PRIMARY',
		},
		{
			type: 'BUTTON',
			customId: 'stop',
			emoji: '⏹️',
			style: 'DANGER',
		},
		{
			type: 'BUTTON',
			customId: 'skip',
			emoji: '⏭️',
			style: 'DANGER',
		},
		{
			type: 'BUTTON',
			customId: 'timeline',
			emoji: '⏳',
			style: 'SECONDARY',
		}]
	},
	{
		type: 'ACTION_ROW', //shuffle | singleLoop | queueloop | autoplay
		components: [
		{
			type: 'BUTTON',
			customId: 'shuffle',
			emoji: '🔀',
			style: 'SECONDARY',
		},
		{
			type: 'BUTTON',
			customId: 'singleloop',
			emoji: '🔂',
			style: 'SECONDARY',
		},
		{
			type: 'BUTTON',
			customId: 'queueloop',
			emoji: '🔁',
			style: 'SECONDARY',

		},
		{
			type: 'BUTTON',
			customId: 'autoplay',
			emoji: '♾️',
			style: 'SECONDARY',
		}]
	},
	{
		type: 'ACTION_ROW', //volumeReduce | volumeIncrease | deleteRecentSong | StackupNextSong | PushdownRecentSong
		components: [
		{
			type: 'BUTTON',
			customId: 'volumereduce',
			emoji: '🔈',
			style: 'SECONDARY',
		},
		{
			type: 'BUTTON',
			customId: 'volumeincrease',
			emoji: '🔊',
			style: 'SECONDARY',
		},
		{
			type: 'BUTTON',
			customId: 'deleterecentsong',
			emoji: '❌',
			style: 'SECONDARY',
		},
		{
			type: 'BUTTON',
			customId: 'stackup',
			emoji: '⤴️',
			style: 'SECONDARY',
		},
		{
			type: 'BUTTON',
			customId: 'pushdown',
			emoji: '⤵️',
			style: 'SECONDARY',
		}]
	}
];

async function syncPlayerChannel(guildId){
	const server = serverInfoList.get(guildId);
	//if(!server.playerInfo.setupped) return;
	const playerChannel = await server.guild.channels.fetch(server.playerInfo.channelId);

	//채널 초기화
	await playerChannel.bulkDelete(10, true);

	const playerBannerMessage = await playerChannel.send({
		content: server.playerInfo.playermsg.banner.messageContent == 'default' ? 
			defaultBannerMessage : server.playerInfo.playermsg.banner.messageContent,
		files: [server.playerInfo.playermsg.banner.imageURL.length == 2 ? 
			server.playerInfo.playermsg.banner.imageURL[1] : server.playerInfo.playermsg.banner.imageURL[0]],
	});

	const playerEmbedMessage = await playerChannel.send({
		content: getPlayerEmbed(server).content,
		embeds: getPlayerEmbed(server).embeds, //노래 틀어져있으면 정보 따라서 아니면 Default
		components: defaultButtonComponents
	});

	server.playerInfo.playermsg.banner.id = playerBannerMessage.id;
	server.playerInfo.playermsg.banner.message = playerBannerMessage;
	server.playerInfo.playermsg.embed.id = playerEmbedMessage.id;
	server.playerInfo.playermsg.embed.message = playerEmbedMessage;

	//messsage collector
	const messageCollector = playerChannel.createMessageCollector();

	messageCollector.on('collect', async msg => {
		// Interactive mix prompts own their timeout and cleanup; do not delete
		// them with the channel's usual five-second bot-message cleanup.
		if (msg.author?.bot && msg.components?.some(row => row.components.some(button => button.customId?.startsWith('mix:')))) return;
		//필터
		if(!msg.type == 'DEFAULT' || msg.member.user.bot){
			setTimeout(() => msg.delete().catch(e => null), 5e3);
		}else{
			const msgs = msg.content.split("\n");
			await wait(5e2);
			await msg.delete().catch(e => null); //오류 좆까
			for(let i = 0; i < msgs.length; i++){
				await require('./stream.js').streamTrigger(msg, msgs[i], 'player');
			}
			await playerEmbedMessage.edit({
				content: getPlayerEmbed(server).content,
				embeds: getPlayerEmbed(server).embeds
			});
		}
	});

	//button collector
	const buttonCollector = playerChannel.createMessageComponentCollector();

	buttonCollector.on('collect', async i => {
		if (!i.isButton() || !defaultButtonComponents.some(row => row.components.some(button => button.customId === i.customId))) return;
		if(!i.isButton() || !i.member.voice.channel || (server.queue.length == 0 && i.customId != 'stop'))
			return i.update().catch(e => null);

		switch(i.customId){
			case 'playpause':
				await server.pause();
				break;

			case 'stop':
				console.log(server.queue.length);
				if(server.queue.length > 1){
					await server.queue.splice(1);
				}else if(server.queue.length == 1){
					await server.stop();
					server.streamInfo.audioPlayer = null;
				}else{
					await server.eject();
					server.streamInfo.audioPlayer = null;
				}
				break;

			case 'skip':
				await server.skip();
				break;

			case 'timeline':
				let timeline = '';
				const curtime = parseInt(server.streamInfo.audioResource.playbackDuration / 1000);
				const durtosec = require('../structures/timestamp.js').timestamptoSecond(server.queue[0].duration);
				const timelinelocate = parseInt(curtime / durtosec * 25);
				for(let i = 0; i < 25; i++){
					timeline = (i != timelinelocate) ? timeline + '━' : timeline + '➤';
				}
				i.channel.send({
					embeds: [
						new MessageEmbed()
							.setColor(process.env.DEFAULT_COLOR)
							.addFields({
								name: `타임라인`,
								value: `[${require('../structures/timestamp.js')
											.getTimestamp(parseInt(
											server.streamInfo.audioResource.playbackDuration / 1000)
											)
										}] ${timeline} [${server.queue[0].duration}]`,
								inline: false,
							})
					]
				});
				break;

			case 'shuffle':
				await server.shuffle();
				break;

			case 'singleloop':
				server.playInfo.loopcode == 1 ? 
					server.playInfo.loopcode = 0 :
					server.playInfo.loopcode = 1;
				break;

			case 'queueloop':
				server.playInfo.loopcode == 2 ? 
					server.playInfo.loopcode = 0 :
					server.playInfo.loopcode = 2;
				break;

			case 'autoplay':
				server.playInfo.loopcode == 3 ? 
					server.playInfo.loopcode = 0 :
					server.playInfo.loopcode = 3;
				if(server.queue.length == 1 && server.playInfo.loopcode == 3){
					require('../../musicdata/functions/stream.js').autosearchPush(i, server);
				}
				break;

			case 'volumereduce':
				server.playInfo.volume = 
					(server.playInfo.volume - 0.1 <= 0) ? 0
					: server.playInfo.volume - 0.1;
				server.streamInfo.audioResource.volume.setVolume(server.playInfo.volume);
				break;

			case 'volumeincrease':
				server.playInfo.volume = 
					(server.playInfo.volume + 0.1 >= 1) ? 1
					: server.playInfo.volume + 0.1;
				server.streamInfo.audioResource.volume.setVolume(server.playInfo.volume);
				break;

			case 'deleterecentsong':
				server.queue.length < 2 ? server.stop() : server.queue.pop();
				if(server.queue.length == 1 && server.playInfo.loopmode == 3){
					require('../../musicdata/functions/stream.js').autosearchPush(i, server);
				}
				break;

			case 'stackup':
				if(server.queue.length > 2) server.queue.push(server.queue.splice(1,1)[0]);
				break;

			case 'pushdown':
				if(server.queue.length > 2) server.queue.splice(1, 0, server.queue.pop());
				break;
		}
		server.queueChanged();
		i.update({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	})
}

module.exports = {
	syncPlayerChannel,
	defaultBannerMessage,
	defaultButtonComponents
}
