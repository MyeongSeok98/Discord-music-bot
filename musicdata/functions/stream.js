const { serverInfoList } = require('../structures/musicServerInfo.js');
const {
	joinVoiceChannel,
	createAudioPlayer,
	createAudioResource,
	VoiceConnectionStatus,
	getVoiceConnection,
	AudioPlayerStatus,
	entersState
} = require('@discordjs/voice');
const {
	MessageEmbed,
	Message,
	Interaction
} = require('discord.js');
global.AbortController = require('node-abort-controller').AbortController;

const { streamScript } = require('../../script.json');
const { pushqueue } = require('./pushqueue.js');
const { getPlayerEmbed } = require('./updateplayer.js');
const { waitForVoiceReady } = require('./voiceconnection.js');

const youtube = require('./youtube.js');
const scdl = require('soundcloud-downloader').default;
const yturlReg = /^https?:\/\/(www.youtube.com|youtube.com|youtu.be)\/(.*)$/;
const scurlReg = /^https?:\/\/(soundcloud\.com|snd\.sc)\/(.*)$/;

require('dotenv').config();

async function streamTrigger(interaction, text, requestType){
	//user must join voicechannel before request the song.
	if(!interaction.member.voice.channel)
		return (interaction instanceof Interaction && interaction.isCommand()) ?
			interaction.editReply({content: streamScript.firstJoinVc}) :
			interaction.channel.send(`${interaction.member.user}, ` + streamScript.firstJoinVc);

	//user and bot joined voice channel, but that channels are different.
	if(interaction.guild.members.me.voice.channel
		&& (interaction.member.voice.channel.id != interaction.guild.members.me.voice.channel.id))
		return (interaction instanceof Interaction && interaction.isCommand()) ? 
			interaction.editReply({
				content: streamScript.alreadyStreaming.interpolate({
					vc: `${interaction.guild.members.me.voice.channel}`
				}), ephemeral: true
			}) :
			interaction.channel.send({
				content: `${interaction.member.user}, ` + streamScript.alreadyStreaming.interpolate({
					vc: `${interaction.guild.members.me.voice.channel}`
				})
			});

	const server = serverInfoList.get(interaction.guild.id);

	//bot is not joined voice channel, but user send a request => bot joins voicechannel.
	if(!server.streamInfo.connection || server.streamInfo.connection.state.status === VoiceConnectionStatus.Destroyed || !server.guild.members.me.voice.channel){
		server.streamInfo.connection = await joinVoiceChannel({
			channelId: interaction.member.voice.channel.id,
			guildId: interaction.guild.id,
			adapterCreator: interaction.guild.voiceAdapterCreator,
			selfDeaf: true,
			selfMute: false
		});
		server.streamInfo.connection.on('stateChange', (oldState, newState) => {
			console.log(`[voice ${server.guild.id}] ${oldState.status} -> ${newState.status}`);
		});
		server.streamInfo.connection.on('error', error => {
			console.error(`[voice ${server.guild.id}]`, error);
		});
	}
	try {
		await waitForVoiceReady(server.streamInfo.connection);
	} catch (error) {
		console.error(`[voice ${server.guild.id}]`, error);
		server.streamInfo.connection = null;
		if (interaction.isCommand?.()) await interaction.editReply(error.message);
		else await interaction.channel.send(error.message);
		return;
	}
	
	server.streamInfo.currentCommandChannel = '<#' + interaction.channel.id + '>';

	server.playInfo.recentChannel = interaction.channel;

	//seperated by request type. there're three types : command, player, playlist(db).
	switch(requestType){
		case 'command':
		case 'player':
			await pushqueue(interaction, text).then(async rm => {
				if(typeof(rm) === 'number') return sendErrorMsg(interaction, rm);

				if(server.queue.length == 1) rm.content = '곡을 추가했습니다. 오디오를 준비하고 있습니다.';

				if(requestType == 'command') interaction.editReply(rm);

				if(!server.streamInfo.audioPlayer && server.queue.length > 0)
					await startStream(interaction, server);

				server.playerInfo.playermsg.embed.message?.edit({
					content: getPlayerEmbed(server).content,
					embeds: getPlayerEmbed(server).embeds
				})

			});

			
			break;

		case 'playlist':
			break;
	}
}

async function startStream(interaction, server){
	const wait = require('util').promisify(setTimeout);
	let errorhandling = 0;
	
	//first playing
	const audioPlayer = createAudioPlayer();
	server.streamInfo.audioPlayer = audioPlayer;

	audioPlayer.on('stateChange', (oldState, newState) => {
		console.log(`[audio ${server.guild.id}] ${oldState.status} -> ${newState.status}`);
	});
	
	//status handler
	audioPlayer.on(AudioPlayerStatus.Playing, async () => {
		server.playInfo.playStatusCode = 1;

		// Playlist tracks may not carry a channel avatar. Do not re-query the
		// broken legacy extractor after playback has already started.
		if (server.queue[0] && !server.queue[0].author.thumbnail) {
			server.queue[0].author.thumbnail = 'https://cdn-icons-png.flaticon.com/512/145/145809.png';
		}
				
		//refresh player embed.
		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});

	audioPlayer.on(AudioPlayerStatus.Idle, async () => {
		if(errorhandling == 1) {
			//기타 핸들링..
			errorhandling = 0;
			return;
		}

		switch(server.playInfo.loopcode){
			case 0:
				server.queue.shift();
				break;

			case 1:
				//카운트 세는거 등등.. 지금은 추가 안함ㅅㄱ
				break;

			case 2:
				server.queue.push(server.queue.shift());
				break;

			case 3:
				if(server.queue.length == 2){
					autosearchPush(interaction, server);
				}
				break;
		}

		if(server.previousqueue.length > 7) server.previousqueue.pop();

		if(server.queue.length > 0) {
			if (await getSongStream(interaction, server)) {
				if(server.playInfo.loopcode != 1 && !server.playerInfo.setupped)
					server.playInfo.recentChannel.send(`지금 재생 중 : **${server.queue[0].title}**`);
			} else {
				errorhandling = 1;
				audioPlayer.stop(true);
				server.streamInfo.audioPlayer = null;
				server.streamInfo.audioResource = null;
			}
		}	

		if(server.queue.length == 0) {
			server.playInfo.playStatusCode = 0;
			if(!server.playerInfo.setupped) await interaction.channel.send('대기열에 노래가 없습니다.');
			server.streamInfo.audioPlayer = null;
			if(server.playInfo.loopcode == 3) 
				await interaction.channel.send('⏹️ 플레이어가 초기화되어 자동 재생 모드가 꺼졌습니다.');
			await server.enterstop();
		}

		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});

	audioPlayer.on(AudioPlayerStatus.Buffering, () => {
		server.playInfo.playStatusCode = 2;

		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});

	audioPlayer.on(AudioPlayerStatus.Paused, () => {
		server.playInfo.playStatusCode = 3;

		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});

	audioPlayer.on('error', e => {
		server.playInfo.playStatusCode = 4;
		errorhandling = 1;
		console.log(e);
		// Do not loop forever on a failed decoder or source. A new request can retry.
		server.streamInfo.audioPlayer = null;
		
		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});
	if (!await getSongStream(interaction, server)) {
		errorhandling = 1;
		audioPlayer.stop(true);
		server.streamInfo.audioPlayer = null;
		server.streamInfo.audioResource = null;
	}
}

// Stream YouTube audio through yt-dlp; keep SoundCloud's existing path.
async function getSongStream(interaction, server){
	let streamSong;
	try{
		streamSong = yturlReg.test(server.queue[0].url) ?
			await youtube.stream(server.queue[0].url) :
			await scdl.download(server.queue[0].url);

		server.streamInfo.audioResource = yturlReg.test(server.queue[0].url) ? 
			await createAudioResource(streamSong.stream, {
				inlineVolume: true,
				inputType: streamSong.type
			}) :
			await createAudioResource(streamSong,{
				inlineVolume: true,
			});
		server.streamInfo.audioResource.volume.setVolume(server.playInfo.volume);

		await server.streamInfo.audioPlayer.play(server.streamInfo.audioResource);
		await server.streamInfo.connection.subscribe(server.streamInfo.audioPlayer);
		server.previousqueue.unshift(server.queue[0]);
		return true;
	}catch(error){
		(streamSong?.stream || streamSong)?.destroy?.();
		server.playInfo.playStatusCode = 4;
		await interaction.channel.send('스트리밍 중 오류가 발생했습니다. 터미널 로그를 확인해 주세요.');
		console.log(error);

		if(error.message.includes('UnrecoverableError')) {
			server.queue.shift();
			(interaction instanceof Interaction) ? 
				interaction.editReply('이 링크는 사용할 수 없습니다. 스킵합니다..') :
				server.playInfo.recentChannel.send('이 링크는 사용할 수 없습니다. 스킵합니다..');
		}
		return false;
	}
}



const { ytsearchGetInfo, ytRelatedGetInfo } = require('./search.js');

async function autosearchPush(interaction, server){

	await interaction.channel?.send('유튜브에서 추천 영상 찾는 중...');

	const related = scurlReg.test(server.queue[0].url) ? //type: queueSong.
		await ytsearchGetInfo(server.queue[0].title, server.playInfo.searchFilter) : 
		await ytRelatedGetInfo(server.queue[0].url, server.playInfo.searchFilter, server.previousqueue);

	if(typeof(related) === 'number')
		return interaction.channel.send(streamScript.errormsg[related]);

	related.request = {
		name: '자동 재생 모드',
		id: 0,
		avatarURL: 'https://images.emojiterra.com/twitter/v13.1/512px/267e.png',
		tag: 0 
	}

	await server.queue.push(related);
	
	server.playerInfo.playermsg.embed.message?.edit({
		content: getPlayerEmbed(server).content,
		embeds: getPlayerEmbed(server).embeds
	})
	
	return interaction.channel ? 
		interaction.channel?.send(`**${related.title}** 대기열 **${server.queue.length - 1}**번에 추가됐습니다`) :
		server.playInfo.recentChannel.send(`**${related.title}** 대기열 **${server.queue.length - 1}**번에 추가됐습니다`);
}

function sendErrorMsg(interaction, errorCode){
	/* list of errorMsg
	 * 0 is not error.
	 * errorcode 1 : 'playlistError', 
	 * errorcode 2 : 'ytUrlError',
	 * errorcode 3 : 'scsetError',
	 * errorcode 4 : 'scError',
	 * errorcode 5 : 'searchFailed',
	 * erorrcode 6 : 'searchError',
	 * errorcode 7 : 'error'
	 */
	console.log(`this error message was sent to ${interaction.guild.id}@${interaction.guild.name}\n`);
	if(typeof(errorCode) === 'number') (interaction instanceof Interaction) ? 
		interaction.editReply(streamScript.errormsg[errorCode]) :
		interaction.channel.send(streamScript.errormsg[errorCode]);
	else interaction.editReply(streamScript.errormsg[0]);
}

module.exports = {
	streamTrigger,
	autosearchPush
}
