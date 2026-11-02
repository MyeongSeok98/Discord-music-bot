# Playback preparation implementation plan

**Goal:** Reduce first-play latency by overlapping voice readiness and metadata lookup;
reduce track transitions by preparing one upcoming YouTube audio stream.

**Architecture:** Keep the existing queue and commands. Split lookup from enqueue so
parallel work cannot mutate the queue before voice succeeds. Own one cancellable,
expiring prefetch per guild. Schedule near the end (20 seconds) and bound the unread
audio buffer to 256 KiB plus stream/process buffers. SoundCloud keeps its existing path.

**Constraints:** No Git commits/pushes. No new dependencies. Public-video extraction
only. No audio files on disk. Respect pause, loop, queue changes, stop and disconnect.
Never play a stale asynchronous result after cancellation.

- [x] Test and implement cancellable YouTube streams and one-item prefetch ownership,
  including failures, replacement, expiry and consumption.
- [x] Test and implement parallel voice/metadata preparation without premature enqueue.
- [x] Integrate per-guild scheduling, queue mutation notifications and stop/disconnect cleanup.
- [x] Run full offline tests, syntax checks, and a public-video prepared-stream smoke test.
- [x] Review async cancellation/races and document actual behavior and remaining manual checks.

## Verification ledger

- Existing queue move cloned every track; changed to a shallow array copy to preserve
  ownership while reordering. Regression test failed before and passed after the fix.
- Stop during an idle transition could retain an idle player. Centralized detach/stop
  in enterstop, with a regression test proving a subsequent request starts normally.
- A public-video smoke test prepared audio in 8.826 s, reused it in under 1 ms,
  measured 326656 buffered bytes (256 KiB target plus a chunk), and decoded Opus.
- Live Discord sound output and subjective transition timing remain manual checks.
- No commit, branch switch, staging, or push performed for this feature.
