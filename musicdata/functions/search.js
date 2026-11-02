const youtube = require('./youtube.js');
const ytsr = require('ytsr');
const scdl = require('soundcloud-downloader').default;
const {
	timestamptoSecond,
	getTimestamp,
} = require('../structures/timestamp.js');
require('dotenv').config();

async function ytplGetInfo(text, options){
    try {
        const playlist = await youtube.getPlaylist(text, options);
        return playlist.items.length ? playlist : 5;
    } catch (error) {
        console.log('playlist lookup failed. reason:');
        console.log(error);
        return 1;
    }
}

async function yturlGetInfo(text){
	try{
		const ytres = await youtube.getInfo(text);

		const durationTimestamp = await getTimestamp(Number(ytres.videoDetails.lengthSeconds));

		return {
			title: ytres.videoDetails.title,
			url: ytres.videoDetails.video_url,
			duration: durationTimestamp,
			thumbnail: `https://i.ytimg.com/vi/${ytres.videoDetails.videoId}/hqdefault.jpg`,
			author: {
				name: ytres.videoDetails.author.name,
				thumbnail: ytres.videoDetails.author.thumbnails[0].url ?? 'https://cdn.icons-icons.com/icons2/730/png/512/youtube_icon-icons.com_62771.png',
				channelURL: ytres.videoDetails.author.channel_url
			}
		}
	}catch(error){
		console.log('youtube-url error. reason : ');
		console.log(error);
		return 2;
	}
}

async function scsetGetInfo(text){
	try{
		const scsetres = await scdl.getSetInfo(text);
		const playlistInfo = {
			info: {
				name: scsetres.title,
				url: scsetres.permalink_url,
				thumbnail: scsetres.artwork_url ?? 'https://download.logo.wine/logo/SoundCloud/SoundCloud-Logo.wine.png',
				author: {
					name: scsetres.user.username,
					thumbnail: scsetres.user.avatar_url ?? 'https://cdn-icons-png.flaticon.com/512/145/145809.png',
					channelURL: scsetres.user.permalink_url,
				}
			},
			items: []
		}

		for(let song of scsetres.tracks){
			const durationTimestamp = await getTimestamp(Number(parseInt(song.duration/1000)));
			
			let resultsong = {
				title: song.title,
				url: song.permalink_url,
				duration: durationTimestamp,
				thumbnail : song.artwork_url ? song.artwork_url.replace('large.jpg', 't500x500.jpg') : 'https://download.logo.wine/logo/SoundCloud/SoundCloud-Logo.wine.png',
				author: {
					name: song.user.username,
					thumbnail: song.user.avatar_url ?? 'https://cdn-icons-png.flaticon.com/512/145/145809.png',
					channelURL: song.user.permalink_url,
				}
			};
			playlistInfo.items.push(resultsong);
		}

		return playlistInfo;

	}catch(error){
		console.log('error from loading soundcloud playlist. reason:');
		console.log(error);
		return 3;
	}
}

async function scurlGetInfo(text){
	try{
		const res = await scdl.getInfo(text);
		const dur = await getTimestamp(Number(parseInt(res.duration/1000)));
		
		return {
			title: res.title,
			url: res.permalink_url,
			thumbnail: res.artwork_url ? res.artwork_url.replace('large.jpg', 't500x500.jpg') : 'https://download.logo.wine/logo/SoundCloud/SoundCloud-Logo.wine.png',
			duration: dur,
			author: {
				name: res.user.username,
				thumbnail: res.user.avatar_url ?? 'https://cdn-icons-png.flaticon.com/512/145/145809.png',
				channelURL: res.user.permalink_url,
			},
		};

	}catch(error){
		console.log('error from soundcloud url. reason:');
		console.log(error);
		return 4;
	}
}

async function ytsearchGetInfo(text, filter){
    try {
        const info = await youtube.search(text, filter);
        if (!info) return 5;
        const video = info.videoDetails;
        return {
            title: video.title,
            url: video.video_url,
            duration: getTimestamp(Number(video.lengthSeconds)),
            thumbnail: 'https://i.ytimg.com/vi/' + video.videoId + '/hqdefault.jpg',
            author: {
                name: video.author.name,
                thumbnail: video.author.thumbnails[0].url,
                channelURL: video.author.channel_url
            }
        };
    } catch (error) {
        console.log('youtube search error. reason : ');
        console.log(error);
        return 6;
    }
}

async function ytplsearchGetInfo(text){
    try {
        const filters = await ytsr.getFilters(text);
        const filteredUrl = filters.get('Type')?.get('Playlist')?.url;
        if (!filteredUrl) return 5;
        const result = await ytsr(filteredUrl, { pages: 1 });
        const playlist = result?.items?.find(item => youtube.parsePlaylistRequest(item?.url));
        if (!playlist) return 5;
        return await ytplGetInfo(playlist.url);
    } catch (error) {
        console.log('playlist search failed. reason:');
        console.log(error);
        return 1;
    }
}

async function ytRelatedGetInfo(text, filter, previousqueue){
    try {
        const info = await youtube.getRelatedInfo(text, filter, previousqueue);
        if (!info) return 5;
        const video = info.videoDetails;
        return {
            title: video.title,
            url: video.video_url,
            duration: getTimestamp(Number(video.lengthSeconds)),
            thumbnail: 'https://i.ytimg.com/vi/' + video.videoId + '/hqdefault.jpg',
            author: {
                name: video.author.name,
                thumbnail: video.author.thumbnails[0].url,
                channelURL: video.author.channel_url
            }
        };
    } catch (error) {
        console.log('youtube auto recommend search error. reason : ');
        console.log(error);
        return 6;
    }
}

module.exports = {
	ytplGetInfo,
	yturlGetInfo,
	scsetGetInfo,
	scurlGetInfo,
	ytsearchGetInfo,
	ytplsearchGetInfo,
	ytRelatedGetInfo
}
