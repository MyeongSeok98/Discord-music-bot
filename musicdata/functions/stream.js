const { serverInfoList } = require('../structures/musicServerInfo.js');
const {
	joinVoiceChannel,
	createAudioPlayer,
	createAudioResource,
	VoiceConnectionStatus,
	AudioPlayerStatus
} = require('@discordjs/voice');
const {
	Interaction
} = require('discord.js');
// Use the native AbortController for cancellable preparation on Node 24.

const { streamScript } = require('../../script.json');
const { pushqueue, resolveRequest } = require('./pushqueue.js');
const { prepareInParallel } = require('./parallel-preparation.js');
const { getPlayerEmbed } = require('./updateplayer.js');
const { waitForVoiceReady } = require('./voiceconnection.js');

const youtube = require('./youtube.js');
const scdl = require('soundcloud-downloader').default;
const yturlReg = /^https?:\/\/(www.youtube.com|youtube.com|youtu.be)\/(.*)$/;
const scurlReg = /^https?:\/\/(soundcloud\.com|snd\.sc)\/(.*)$/;

require('dotenv').config();

async function streamTrigger(interaction, text, requestType){
    if (requestType !== 'command' && requestType !== 'player') return;
    const reply = message => requestType === 'command'
        ? interaction.editReply(message) : interaction.channel.send(message);
    const memberChannel = interaction.member.voice.channel;
    if (!memberChannel) return reply(streamScript.firstJoinVc);
    const botChannel = interaction.guild.members.me.voice.channel;
    if (botChannel && botChannel.id !== memberChannel.id) {
        return reply(streamScript.alreadyStreaming.interpolate({ vc: String(botChannel) }));
    }
    const server = serverInfoList.get(interaction.guild.id);
    const state = server.streamInfo;
    const existingChannel = state.connection?.joinConfig?.channelId;
    if (state.connection?.state.status !== VoiceConnectionStatus.Destroyed && existingChannel && existingChannel !== memberChannel.id) {
        return reply(streamScript.alreadyStreaming.interpolate({ vc: '<#' + existingChannel + '>' }));
    }
    const generation = state.requestGeneration;
    state.pendingRequests++;
    let committed = false;
    try {
        const prepared = await prepareInParallel(async () => {
            let connection = state.connection;
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed
                && connection.joinConfig?.channelId && connection.joinConfig.channelId !== memberChannel.id) {
                throw new Error('다른 음성 채널에서 연결을 준비하고 있습니다.');
            }
            if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
                connection = joinVoiceChannel({
                    channelId: memberChannel.id, guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                    selfDeaf: true, selfMute: false
                });
                state.connection = connection;
                state.temporaryConnection = true;
                connection.on('stateChange', (oldState, newState) => {
                    console.log('[voice ' + server.guild.id + '] ' + oldState.status + ' -> ' + newState.status);
                    if (newState.status === VoiceConnectionStatus.Destroyed && state.connection === connection) {
                        server.enterstop();
                        state.audioPlayer?.stop(true);
                        state.audioPlayer = null;
                    }
                });
                connection.on('error', error => console.error('[voice ' + server.guild.id + ']', error));
            }
            await waitForVoiceReady(connection);
            return connection;
        }, () => resolveRequest(interaction, text));
        if (generation !== state.requestGeneration) return reply('재생 준비 중 요청이 취소되었습니다.');
        if (typeof prepared.request === 'number' || !prepared.request) {
            return sendErrorMsg(interaction, prepared.request || 7);
        }
        if (state.connection !== prepared.connection || prepared.connection.state.status !== VoiceConnectionStatus.Ready) {
            throw new Error('음성 연결이 종료되었습니다. 다시 요청해 주세요.');
        }
        state.currentCommandChannel = '<#' + interaction.channel.id + '>';
        server.playInfo.recentChannel = interaction.channel;
        const message = await pushqueue(interaction, text, prepared.request);
        committed = true;
        state.temporaryConnection = false;
        if (server.queue.length === 1) message.content = '곡을 추가했습니다. 오디오를 준비하고 있습니다.';
        if (requestType === 'command') await interaction.editReply(message);
        server.queueChanged();
        if (!state.audioPlayer && server.queue.length) await startStream(interaction, server);
        await server.playerInfo.playermsg.embed.message?.edit(getPlayerEmbed(server));
    } catch (error) {
        console.error('[prepare ' + server.guild.id + ']', error);
        await reply('음성 연결 또는 곡 준비에 실패했습니다. 연결·말하기 권한과 터미널 로그를 확인해 주세요.');
    } finally {
        state.pendingRequests--;
        if (!committed && !state.pendingRequests && state.temporaryConnection && !server.queue.length) {
            const connection = state.connection;
            state.temporaryConnection = false;
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
            if (state.connection === connection) state.connection = null;
        }
    }
}

async function startStream(interaction, server){
	let errorhandling = 0;
	
	//first playing
	const audioPlayer = createAudioPlayer();
	server.streamInfo.audioPlayer = audioPlayer;

	audioPlayer.on('stateChange', (oldState, newState) => {
		console.log(`[audio ${server.guild.id}] ${oldState.status} -> ${newState.status}`);
		if (server.streamInfo.audioPlayer !== audioPlayer) return;
		if ([AudioPlayerStatus.Paused, AudioPlayerStatus.AutoPaused].includes(newState.status)) {
			server.streamInfo.prefetch?.cancel();
		}
	});
	
	//status handler
	audioPlayer.on(AudioPlayerStatus.Playing, async () => {
		if (server.streamInfo.audioPlayer !== audioPlayer) return;
		server.playInfo.playStatusCode = 1;
		server.queueChanged();

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

	const advanceTrack = async () => {
		if (server.streamInfo.audioPlayer !== audioPlayer) return;
		const generation = server.streamInfo.playbackGeneration;
		if(errorhandling == 1) {
			//기타 핸들링..
			errorhandling = 0;
			return;
		}

		if (server.queue.length) switch(server.playInfo.loopcode){
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
				if(server.queue.length === 1){
					await autosearchPush(interaction, server);
				}
				if (generation !== server.streamInfo.playbackGeneration) return;
				server.queue.shift();
				break;
		}

		if(server.previousqueue.length > 7) server.previousqueue.pop();

		if(server.queue.length > 0) {
			const played = await getSongStream(interaction, server);
			if (played === null) return;
			if (played) {
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
			const wasAutoplay = server.playInfo.loopcode == 3;
			server.streamInfo.audioPlayer = null;
			server.enterstop({ cancelRequests: false });
			if(!server.playerInfo.setupped) await interaction.channel.send('대기열에 노래가 없습니다.');
			if(wasAutoplay)
				await interaction.channel.send('⏹️ 플레이어가 초기화되어 자동 재생 모드가 꺼졌습니다.');
		}

		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	};
	server.streamInfo.advanceTrack = advanceTrack;
	audioPlayer.on(AudioPlayerStatus.Idle, () => {
		advanceTrack().catch(error => console.error(`[advance ${server.guild.id}]`, error));
	});

	audioPlayer.on(AudioPlayerStatus.Buffering, () => {
		if (server.streamInfo.audioPlayer !== audioPlayer) return;
		server.playInfo.playStatusCode = 2;

		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});

	audioPlayer.on(AudioPlayerStatus.Paused, () => {
		if (server.streamInfo.audioPlayer !== audioPlayer) return;
		server.playInfo.playStatusCode = 3;

		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});

	audioPlayer.on('error', e => {
		if (server.streamInfo.audioPlayer !== audioPlayer) return;
		server.playInfo.playStatusCode = 4;
		errorhandling = 1;
		console.log(e);
		// Do not loop forever on a failed decoder or source. A new request can retry.
		server.streamInfo.audioPlayer = null;
		server.streamInfo.prefetch?.cancel();
		
		server.playerInfo.playermsg.embed.message?.edit({
			content: getPlayerEmbed(server).content,
			embeds: getPlayerEmbed(server).embeds
		})
	});
	if (await getSongStream(interaction, server) === false) {
		errorhandling = 1;
		audioPlayer.stop(true);
		server.streamInfo.audioPlayer = null;
		server.streamInfo.audioResource = null;
	}
}

// Stream YouTube audio through yt-dlp; keep SoundCloud's existing path.
async function getSongStream(interaction, server){
    const state = server.streamInfo;
    const track = server.queue[0];
    const player = state.audioPlayer;
    const generation = state.playbackGeneration;
    state.sourceController?.abort();
    const controller = new AbortController();
    state.sourceController = controller;
    const current = () => !controller.signal.aborted && generation === state.playbackGeneration
        && server.queue[0] === track && state.audioPlayer === player;
    let source;
    try {
        const isYoutube = yturlReg.test(track.url);
        if (isYoutube) {
            source = await state.prefetch?.take(track);
            if (!current()) { source?.stream.destroy(); return null; }
            console.log('[prefetch ' + server.guild.id + '] ' + (source ? 'hit' : 'miss'));
            if (!source) source = await youtube.stream(track.url, { signal: controller.signal });
        } else source = await scdl.download(track.url);
        if (!current()) { (source?.stream || source)?.destroy?.(); return null; }
        const resource = createAudioResource(isYoutube ? source.stream : source, {
            inlineVolume: true, ...(isYoutube ? { inputType: source.type } : {})
        });
        resource.volume.setVolume(server.playInfo.volume);
        state.audioResource = resource;
        player.play(resource);
        state.connection.subscribe(player);
        server.previousqueue.unshift(track);
        return true;
    } catch (error) {
        (source?.stream || source)?.destroy?.();
        if (!current() || error.name === 'AbortError') return null;
        server.playInfo.playStatusCode = 4;
        await interaction.channel.send('스트리밍 중 오류가 발생했습니다. 터미널 로그를 확인해 주세요.');
        console.error(error);
        return false;
    } finally {
        if (state.sourceController === controller) state.sourceController = null;
    }
}

const { ytsearchGetInfo, ytRelatedGetInfo } = require('./search.js');

async function autosearchPush(interaction, server){
	const seed = server.queue[0];
	const generation = server.streamInfo.requestGeneration;
	if (!seed) return;

	await interaction.channel?.send('유튜브에서 추천 영상 찾는 중...');

	const related = scurlReg.test(seed.url) ? //type: queueSong.
		await ytsearchGetInfo(seed.title, server.playInfo.searchFilter) :
		await ytRelatedGetInfo(seed.url, server.playInfo.searchFilter, server.previousqueue);
	if (generation !== server.streamInfo.requestGeneration || !server.queue.includes(seed) || server.playInfo.loopcode !== 3) return;

	if(typeof(related) === 'number')
		return interaction.channel.send(streamScript.errormsg[related]);

	related.request = {
		name: '자동 재생 모드',
		id: 0,
		avatarURL: 'https://images.emojiterra.com/twitter/v13.1/512px/267e.png',
		tag: 0 
	}

	await server.queue.push(related);
	server.queueChanged();
	
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
