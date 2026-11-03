# Mix selection implementation plan

Use the agreed two-button flow for RD links in both /play and player-channel
messages: single video, or a modal accepting an integer from 1 to 10.
Only the requester may choose. Do not connect, extract, or enqueue until selection
finishes. Invalid input allows retry; expire unanswered prompts after two minutes.
Ignore late modal results and cancelled sessions, recheck the user's voice channel.

- [x] Add tests and parameterize the mix extraction limit (1–10).
- [x] Add and test the button/modal selection flow and cancellation handling.
- [x] Integrate before parallel preparation; isolate player/loop collectors.
- [x] Run full tests, syntax checks, review, and public five-track metadata smoke test.
- [x] Update usage documentation. No Git commit or push.

Review correction: the modal waiter now lasts until the same two-minute deadline
as the prompt. Reopening the input reuses one waiter and prompt-scoped modal ID;
late submissions after a single-song choice cannot enqueue anything.
Actual Discord button/modal rendering still requires manual verification.
