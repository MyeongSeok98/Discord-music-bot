// Keep the legacy queue metadata shape while replacing broken ytdl-core extraction.
const { spawn } = require('node:child_process');
const { PassThrough } = require('node:stream');
const downloader = require('youtube-dl-exec');
const { StreamType } = require('@discordjs/voice');
const { getTimestamp } = require('../structures/timestamp');

const fallbackAvatar = 'https://cdn-icons-png.flaticon.com/512/145/145809.png';
const baseFlags = {
  ignoreConfig: true,
  noPlaylist: true,
  noWarnings: true,
  jsRuntimes: `node:${process.execPath}`
};

function parsePlaylistRequest(text) {
  try {
    const parsed = new URL(text.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)
      || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(parsed.hostname)) return null;
    const list = parsed.searchParams.get('list');
    if (!list || !/^[\w-]{1,128}$/.test(list)) return null;
    const isMix = list.startsWith('RD');
    const videoId = (parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v'))
      || (isMix ? /^RD([\w-]{11})$/.exec(list)?.[1] : null);
    if (videoId && !/^[\w-]{11}$/.test(videoId)) return null;
    if (isMix && !videoId) return null;
    const index = Number(parsed.searchParams.get('index'));
    return {
      url: isMix
        ? `https://www.youtube.com/watch?v=${videoId}&list=${list}&start_radio=1`
        : `https://www.youtube.com/playlist?list=${list}`,
      isMix,
      videoId: videoId || null,
      index: Number.isSafeInteger(index) && index > 0 ? index : null
    };
  } catch { return null; }
}

function videoInfo(info) {
  if (!info?.id || !info.title) throw new Error('YouTube video metadata is missing');
  return {
    videoDetails: {
      videoId: info.id,
      title: info.title,
      video_url: info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
      lengthSeconds: String(Math.floor(info.duration || 0)),
      author: {
        name: info.channel || info.uploader || 'YouTube',
        channel_url: info.channel_url || info.uploader_url || 'https://www.youtube.com',
        thumbnails: [{ url: fallbackAvatar }]
      }
    }
  };
}

function createYoutube({ extract = downloader, spawnProcess = spawn,
  relatedInfo = require('play-dl').video_info } = {}) {
  async function getInfo(url, { timeout = 45000 } = {}) {
    const info = await extract(url, {
      ...baseFlags, dumpSingleJson: true, skipDownload: true
    }, { timeout, windowsHide: true });
    return videoInfo(info);
  }

  async function search(query, filter = {}) {
    if (typeof query !== 'string' || !query.trim()) return null;
    const deadline = Date.now() + 30000;
    const { noPlaylist, ...searchFlags } = baseFlags;
    const results = await extract(`ytsearch10:${query.trim()}`, {
      ...searchFlags, dumpSingleJson: true, flatPlaylist: true, skipDownload: true
    }, { timeout: 30000, windowsHide: true });
    const keywords = (Array.isArray(filter?.banKeywords) ? filter.banKeywords : [])
      .filter(word => typeof word === 'string' && word.trim()).map(word => word.trim().toLowerCase());
    const requestedLimit = Number(filter?.durationLimit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 0;
    const banned = title => keywords.some(word => title.toLowerCase().includes(word));
    const entries = Array.isArray(results?.entries) ? results.entries.slice(0, 10) : [];
    for (const entry of entries) {
      if (!entry || !/^[\w-]{11}$/.test(entry.id || '') || typeof entry.title !== 'string' || !entry.title.trim()) continue;
      if (banned(entry.title) || entry.is_live || ['is_live', 'is_upcoming'].includes(entry.live_status)) continue;
      if (['private', 'needs_auth', 'premium_only', 'subscriber_only'].includes(entry.availability)) continue;
      let result;
      const seconds = entry.duration == null ? NaN : Number(entry.duration);
      if (Number.isFinite(seconds) && seconds > 0) {
        if (limit && seconds > limit) continue;
        result = videoInfo({ ...entry, duration: seconds });
      } else {
        // Flat results can omit duration. Verify only that candidate instead
        // of fully extracting every search result up front.
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('YouTube title search timed out');
        try { result = await getInfo(`https://www.youtube.com/watch?v=${entry.id}`, { timeout: Math.min(10000, remaining) }); }
        catch { continue; }
      }
      const video = result.videoDetails;
      if (banned(video.title) || !Number.isFinite(Number(video.lengthSeconds)) || Number(video.lengthSeconds) <= 0) continue;
      if (limit && Number(video.lengthSeconds) > limit) continue;
      return result;
    }
    return null;
  }

  async function getPlaylist(text, { mixCount = 10 } = {}) {
    const request = parsePlaylistRequest(text);
    if (!request) throw new Error('올바른 YouTube 재생목록 링크가 아닙니다.');
    if (request.isMix && (!Number.isInteger(mixCount) || mixCount < 1 || mixCount > 10)) {
      throw new RangeError('믹스 곡 수는 1~10 사이의 정수여야 합니다.');
    }
    const limit = request.isMix ? mixCount : 1972;
    const { noPlaylist, ...playlistFlags } = baseFlags;
    const result = await extract(request.url, {
      ...playlistFlags, dumpSingleJson: true, flatPlaylist: true, skipDownload: true,
      playlistEnd: limit, ignoreErrors: true
    }, { timeout: 45000, windowsHide: true });
    const entries = Array.isArray(result?.entries) ? result.entries.slice(0, limit) : [];
    let start = 0;
    const hinted = request.index == null ? -1 : entries.findIndex((entry, i) => Number(entry?.playlist_index ?? i + 1) === request.index);
    if (request.videoId) {
      start = hinted >= 0 && entries[hinted]?.id === request.videoId
        ? hinted : entries.findIndex(entry => entry?.id === request.videoId);
      if (start < 0) throw new Error(`선택한 영상이 재생목록의 처음 ${limit}개 항목에서 발견되지 않았습니다.`);
    } else if (request.index != null) {
      if (hinted < 0) throw new Error('재생목록의 시작 위치를 찾지 못했습니다.');
      start = hinted;
    }
    // Slice before dropping unavailable entries so index=3 still means the
    // third position in the original playlist, not the third surviving video.
    const items = [];
    for (const entry of entries.slice(start)) {
      if (!entry || !/^[\w-]{11}$/.test(entry.id || '') || typeof entry.title !== 'string' || !entry.title.trim()) continue;
      if (entry.is_live || ['is_live', 'is_upcoming'].includes(entry.live_status)) continue;
      if (['private', 'needs_auth', 'premium_only', 'subscriber_only'].includes(entry.availability)
        || /^\[(?:private|deleted) video\]$/i.test(entry.title)) continue;
      const seconds = Number(entry.duration);
      items.push({
        title: entry.title,
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        duration: getTimestamp(Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0),
        thumbnail: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
        author: {
          name: entry.channel || entry.uploader || 'YouTube',
          thumbnail: fallbackAvatar,
          channelURL: entry.channel_url || entry.uploader_url || 'https://www.youtube.com'
        }
      });
    }
    return {
      info: {
        name: result?.title || 'YouTube 재생목록',
        url: request.url,
        thumbnail: result?.thumbnail || result?.thumbnails?.at(-1)?.url || items[0]?.thumbnail,
        author: {
          name: result?.channel || result?.uploader || 'YouTube',
          thumbnail: fallbackAvatar,
          channelURL: result?.channel_url || result?.uploader_url || 'https://www.youtube.com'
        }
      },
      items
    };
  }

  async function getRelatedInfo(url, filter, history) {
    const info = await relatedInfo(url);
    const videoId = value => {
      try {
        const parsed = new URL(value);
        return parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
      } catch { return null; }
    };
    const previousIds = new Set(history.map(song => videoId(song?.url)));
    previousIds.add(videoId(url));
    for (const candidate of (info.related_videos || []).slice(0, 10)) {
      if (previousIds.has(videoId(candidate))) continue;
      let result;
      try { result = await getInfo(candidate); } catch { continue; }
      const video = result.videoDetails;
      if (filter.banKeywords.some(word => video.title.toLowerCase().includes(word.toLowerCase()))) continue;
      if (filter.durationLimit && Number(video.lengthSeconds) > filter.durationLimit) continue;
      return result;
    }
    return null;
  }

  function stream(url, { signal, highWaterMark = 256 * 1024 } = {}) {
    if (signal?.aborted) return Promise.reject(new DOMException('Audio preparation cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const child = spawnProcess(downloader.constants.YOUTUBE_DL_PATH, [
        ...downloader.args(baseFlags), '--quiet', '--no-progress',
        '--format', 'bestaudio/best', '--output', '-', '--', url
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      // stdout can reach EOF before the exit status is known. Hold our own
      // stream open so a failed partial download cannot look like a full song.
      const audio = new PassThrough({ highWaterMark });
      let started = false;
      let stderr = '';
      const timer = setTimeout(() => {
        fail(new Error('YouTube audio download timed out'));
      }, 45000);
      function fail(error) {
        clearTimeout(timer);
        if (started) audio.destroy(error);
        else {
          reject(error);
          audio.destroy();
        }
        if (child.exitCode === null && !child.killed) child.kill();
      }
      const abort = () => {
        if (started) {
          clearTimeout(timer);
          audio.destroy();
        } else fail(new DOMException('Audio preparation cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.once('error', fail);
      audio.once('error', error => {
        clearTimeout(timer);
        if (!started) reject(error);
      });
      child.stdout.once('error', fail);
      audio.once('readable', () => {
        if (!audio.readableLength) return;
        started = true;
        clearTimeout(timer);
        resolve({ stream: audio, type: StreamType.Arbitrary });
      });
      audio.once('close', () => {
        signal?.removeEventListener('abort', abort);
        child.stdout.destroy();
        if (child.exitCode === null && !child.killed) child.kill();
      });
      child.stdout.pipe(audio, { end: false });
      child.once('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) return;
        if (child.killed && started) return;
        if (code !== 0 || !started) {
          fail(new Error(stderr.trim() || `YouTube downloader exited without audio (${code})`));
        } else audio.end();
      });
    });
  }
  return { getInfo, search, getPlaylist, getRelatedInfo, stream };
}

module.exports = { ...createYoutube(), createYoutube, parsePlaylistRequest };
