// Keep the legacy queue metadata shape while replacing broken ytdl-core extraction.
const { spawn } = require('node:child_process');
const { PassThrough } = require('node:stream');
const downloader = require('youtube-dl-exec');
const { StreamType } = require('@discordjs/voice');

const fallbackAvatar = 'https://cdn-icons-png.flaticon.com/512/145/145809.png';
const baseFlags = {
  ignoreConfig: true,
  noPlaylist: true,
  noWarnings: true,
  jsRuntimes: `node:${process.execPath}`
};

function createYoutube({ extract = downloader, spawnProcess = spawn,
  relatedInfo = require('play-dl').video_info } = {}) {
  async function getInfo(url) {
    const info = await extract(url, {
      ...baseFlags, dumpSingleJson: true, skipDownload: true
    }, { timeout: 45000, windowsHide: true });
    if (!info.id || !info.title) throw new Error('YouTube video metadata is missing');
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

  function stream(url) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(downloader.constants.YOUTUBE_DL_PATH, [
        ...downloader.args(baseFlags), '--quiet', '--no-progress',
        '--format', 'bestaudio/best', '--output', '-', '--', url
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      // stdout can reach EOF before the exit status is known. Hold our own
      // stream open so a failed partial download cannot look like a full song.
      const audio = new PassThrough();
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
        child.stdout.destroy();
        if (child.exitCode === null && !child.killed) child.kill();
      });
      child.stdout.pipe(audio, { end: false });
      child.once('close', code => {
        clearTimeout(timer);
        if (child.killed && started) return;
        if (code !== 0 || !started) {
          fail(new Error(stderr.trim() || `YouTube downloader exited without audio (${code})`));
        } else audio.end();
      });
    });
  }
  return { getInfo, getRelatedInfo, stream };
}

module.exports = { ...createYoutube(), createYoutube };
