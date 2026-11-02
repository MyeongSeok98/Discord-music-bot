// One upcoming track per guild. The caller retains no ownership after take().
class TrackPrefetch {
  constructor(openStream, { ttlMs = 60000, now = Date.now } = {}) {
    this.openStream = openStream;
    this.ttlMs = ttlMs;
    this.now = now;
    this.entry = null;
  }

  cancel() {
    const entry = this.entry;
    this.entry = null;
    if (!entry) return;
    clearTimeout(entry.timer);
    clearTimeout(entry.expiry);
    entry.controller.abort();
    entry.source?.stream.destroy();
  }

  schedule(track, delay = 0) {
    if (!track) { this.cancel(); return; }
    if (this.entry?.track !== track) {
      this.cancel();
      this.entry = { track, controller: new AbortController() };
    }
    const entry = this.entry;
    if (entry.promise) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.prepare(track), Math.max(0, delay));
    entry.timer.unref?.();
  }

  prepare(track) {
    if (this.entry?.track !== track) {
      this.cancel();
      this.entry = { track, controller: new AbortController() };
    }
    const entry = this.entry;
    clearTimeout(entry.timer);
    if (entry.promise) return entry.promise;
    entry.promise = Promise.resolve().then(() => this.openStream(track.url, {
      signal: entry.controller.signal, highWaterMark: 256 * 1024
    })).then(source => {
      if (this.entry !== entry || entry.controller.signal.aborted) {
        source.stream.destroy();
        return null;
      }
      entry.source = source;
      entry.readyAt = this.now();
      // Background errors invalidate the entry; the foreground path will retry.
      source.stream.once('error', () => { if (this.entry === entry) this.cancel(); });
      entry.expiry = setTimeout(() => {
        if (this.entry === entry) this.cancel();
      }, this.ttlMs);
      entry.expiry.unref?.();
      return source;
    }).catch(() => null);
    return entry.promise;
  }

  async take(track) {
    const entry = this.entry;
    if (!entry || entry.track !== track || !entry.promise) {
      this.cancel();
      return null;
    }
    const source = await entry.promise;
    if (this.entry !== entry) return null;
    if (!source || source.stream.destroyed || this.now() - entry.readyAt >= this.ttlMs) {
      this.cancel();
      return null;
    }
    clearTimeout(entry.expiry);
    this.entry = null;
    return source;
  }
}

function getNextTrack(queue, loopcode) {
  if (!queue.length) return null;
  if (loopcode === 1) return queue[0];
  return queue[1] || (loopcode === 2 ? queue[0] : null);
}

function refreshPrefetch(server) {
  const state = server.streamInfo;
  if (!state.prefetch) state.prefetch = new TrackPrefetch(require('./youtube.js').stream);
  const next = getNextTrack(server.queue, server.playInfo.loopcode);
  const playing = state.audioPlayer?.state.status === 'playing';
  if (!playing || !next || !/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//.test(next.url)) {
    state.prefetch.cancel();
    return;
  }
  const duration = require('../structures/timestamp').timestamptoSecond(server.queue[0].duration);
  if (!Number.isFinite(duration) || duration <= 0) { state.prefetch.cancel(); return; }
  const remaining = duration - (state.audioResource?.playbackDuration || 0) / 1000;
  state.prefetch.schedule(next, Math.max(0, remaining - 20) * 1000);
}

module.exports = { TrackPrefetch, getNextTrack, refreshPrefetch };
