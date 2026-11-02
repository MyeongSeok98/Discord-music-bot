const serverInfoList = new Map();
const { AudioPlayerStatus } = require('@discordjs/voice');
const { refreshPrefetch } = require('../functions/prefetch.js');
require('dotenv').config();

class serverInfo {
	constructor(guild){
		this.guild = guild; //get id, name, guild.
		this.queue = []; //can save songs maximum 1972.
		this.previousqueue = []; //maximum : 7 songs.
		this.streamInfo = {
			commandChannel: '0',
			currentCommandChannel : '',
			streaming: false,
			connection: null, //assigned by joinVoiceChannel or getVoiceStatus Function.
			audioPlayer: null, //assigned by createAudioPlayer();
			audioResource: null, //assigned by createAudioResource();
			prefetch: null,
			sourceController: null,
			playbackGeneration: 0,
			requestGeneration: 0,
			pendingRequests: 0,
			temporaryConnection: false,
		};
		this.playInfo = {
			//나중에 script.json에 저장
			playStatus: ['⏹ 재생 중이 아니다냐', '▶️ 지금 재생 중이다냐', '*️⃣ 버퍼링 중이다냐...', '⏸️ 일시정지됬다냐', '⚠️ 오류 발생이다냐'],
			playStatusCode: 0, //max 4
			loopmode: ['➡️ 기본 재생 모드다냐', '🔂 반복 재생 모드다냐', '🔁 대기열 반복 모드다냐', '♾️ 자동 재생 모드다냐'],
			loopcode: 0, //max 3
			volume: 0.3,
			searchFilter: {
				durationLimit: 0,
				banKeywords: [],
			},
			recentChannel: null,
		};
		this.playerInfo = { // *must save db.
			setupped: false,
			channelId: '',
			channelName: '',
			playermsg: {
				banner: {
					id: '',
					messageContent: 'default',
					message: null,
					imageURL: ['./imgs/playerbanner.png'],
				},
				embed: {
					id: '',
					messageContent: 'default',
					message: null,
					imageURL: [`${process.env.PLAYEREMBED_IMAGEURL}`],
				}
			}
		};
	}

	cancelPreparation({ cancelRequests = true } = {}) {
		this.streamInfo.playbackGeneration++;
		if (cancelRequests) this.streamInfo.requestGeneration++;
		this.streamInfo.prefetch?.cancel();
		this.streamInfo.sourceController?.abort();
	}

	queueChanged() { refreshPrefetch(this); }

	enterstop(options){
		this.cancelPreparation(options);
		const player = this.streamInfo.audioPlayer;
		const resource = this.streamInfo.audioResource;
		// Detach before stopping: an already-idle player emits no new Idle event.
		this.streamInfo.audioPlayer = null;
		this.streamInfo.advanceTrack = null;
		this.streamInfo.sourceController = null;
		this.playInfo.playStatusCode = 0;
		this.playInfo.loopcode = 0;
		this.streamInfo.audioResource = null;
		this.queue = [];
		player?.stop(true);
		resource?.playStream?.destroy();
	}
}

//musicserver default commands.
class musicFunctions extends serverInfo {
	constructor(guild){
		super(guild);
	}
	//default funcitons. (dont need arguments.)
	//np, viewqueue는 command만 가능함. 여따 안넣고 defaultMusicCommands에다 넣기 ㄱ
	pause() {
		const result = this.streamInfo.audioPlayer.state.status == 'paused' ?
			this.streamInfo.audioPlayer.unpause() :
			this.streamInfo.audioPlayer.pause(true);
		this.queueChanged();
		return result;
	}

	async stop() {
		super.enterstop();
		return true;
	}

	skip() {
		if (this.streamInfo.sourceController) {
			this.streamInfo.playbackGeneration++;
			this.streamInfo.sourceController.abort();
			return this.streamInfo.advanceTrack?.();
		}
		this.streamInfo.audioPlayer?.stop(true);
	}


	async eject() {
		super.enterstop();
		this.streamInfo.connection?.destroy();
		this.streamInfo.connection = null;
	}

	//advanced functions, but dont require arguments.
	async shuffle(){
		if(this.queue.length < 3) return false;
		for(let i = this.queue.length - 1; i >= 0; i--){
			let j = Math.floor((Math.random() * i)) + 1;
			if(j == 0 || i == 0) continue;
			[
				this.queue[i], this.queue[j]
			] = [
				this.queue[j], this.queue[i]
			];
		}
		this.queueChanged();
		return true;
	}

	volume(size){
		if(size < 1 || size > 100) return false;
		this.streamInfo.audioResource.volume.setVolume(size / 100);
		this.playInfo.volume = size / 100;
		return true;
	}

	jump(goto){
		if(goto >= this.queue.length) return false;
		this.streamInfo.prefetch?.cancel();
		this.playInfo.loopcode == 2 ? 
			this.queue = this.queue.concat(this.queue.splice(0, goto-1)) :
			this.queue.splice(0, goto-1);
		this.skip();
		return true;
	}

	remove(range1, range2){
		if(this.queue.length == 1) return 'rmWarn1';
		if(range1 < 1) return 'rmWarn2';

		if(range2){
			[range1, range2] = range1 <= range2 ? 
				[range1, range2] : 
				[range2, range1];
		}

		!range2 ? 
			this.queue.splice(range1, 1) :
			this.queue.splice(range1, range2 - range1 + 1);
		this.queueChanged();
		return range1 == 1 && range2 == this.queue.length-1 ? 'rmclear1' 
			: !range2 ? 'rmclear0'
			: 'rmclear2';
	}

	move(range1, range2){
		if(this.queue.length < 3 ) return 'moveWarn1';
		if(range1 > this.queue.length-1 || range1 < 1) return 'moveWarn2';
		if(range2 > this.queue.length-1 || range2 < 1) return 'moveWarn3';
		if(range1 == range2) return 'moveWarn4';

		function movearray(list, target, moveValue){
			const newpos = Number(target) + Number(moveValue);
			// Queue entries also identify in-flight and prepared audio ownership.
			// Reordering must not replace every track with a cloned object.
			const tempList = list.slice();
			const totarget = tempList.splice(target, 1)[0];
			tempList.splice(newpos, 0, totarget);
			return tempList;
		}
		this.queue = movearray(this.queue, range1, range2 - range1);
		this.queueChanged();
		return true;
	}

	refresh(){
		super.enterstop();
		this.streamInfo.connection?.destroy();
	}
}

module.exports = {
	serverInfo,
	serverInfoList,
	musicFunctions
}
