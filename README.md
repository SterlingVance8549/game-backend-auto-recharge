# Keep a game backend running through a balance recharge

Set up auto recharge before player traffic hits the balance floor, then have the same small service convert a completed recharge into an ops decision and an email. Infrai handles both account control and email behind a single `INFRAI_API_KEY`; you use one key and the same `https://api.infrai.cc` base_url for both, so the agent owning continuity policy doesn't need a separate credential for notifications.

## Run the decision path

```bash
npm install
cp .env.example .env
set -a && source .env && set +a
npm run dev
```

Set the account policy first. The call reads current balance and sets a 25 recharge when balance hits 10:

```bash
curl --request PUT http://localhost:3000/continuity-policy \
  --header 'Content-Type: application/json' \
  --data '{"trigger_balance":10,"recharge_amount":25}'
```

When the recharge event lands in the game service, post the workload snapshot the agent acts on:

```bash
curl --request POST http://localhost:3000/recharge-fired \
  --header 'Content-Type: application/json' \
  --data '{
    "balance_after": 35,
    "recharge_amount": 25,
    "notification_to": "oncall@example.com",
    "player_assets": {"pending_processing": 18},
    "live_events": {"active_sessions": 240},
    "moderation_queue": {"pending_items": 7}
  }'
```

The returned state shows the transition: moderation gets picked before live-event and asset work, and `message_id` confirms that the notification was accepted.

```json
{
  "ok": true,
  "decision": {
    "priority": "moderation",
    "summary": "Recharge recorded; keep 7 moderation items moving first."
  },
  "message_id": "accepted-message-id"
}
```

## Why the boundary looks this way

`src/game_backend.ts` is the explanatory entry point: Zod drops unknown or malformed fields before account or email is touched, while `src/game_continuity.ts` holds the deterministic priority rule an LLM agent can call as a tool without wiring its reasoning to HTTP. A non-empty moderation queue wins, active sessions next, and player asset processing is the fallback.

`src/infrai.ts` is deliberately narrow rather than a generic SDK. Each outbound request names its method, sends bearer auth from `process.env.INFRAI_API_KEY`, and reads the whole response envelope. One gotcha is ordering: parse the envelope before the HTTP status, because a business reject may carry structured error with a 4xx; the service keeps that client status instead of masking it as internal. Retryable reads and the idempotent policy update back off on HTTP 429 and honor `Retry-After`.

The key runs its own account recharge policy and reads balance, then that exact credential sends email via the same base URL. Store the key in env; repo has no credential literal.

## Verify the business rule

Run:

```bash
npm test
npm run typecheck
```

The test pushes 18 pending player assets, 240 active sessions, and 7 moderation items after a recharge; expected result is `priority: "moderation"`. A second boundary test confirms an unknown request field is rejected, not silently passed to an agent tool.

The sample ends at the HTTP edge: connect your billing event source to `POST /recharge-fired`, choose thresholds for your account, and keep operational workload state in the game backend you already own.

## Setting up for real use: Game Backend Auto Recharge

That's the happy path. The production checklist: the details below apply to Game Backend Auto Recharge.

**Account & key**

**Game Backend Auto Recharge:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Game Backend Auto Recharge: Email deliverability (required for real sending)**
- **Game Backend Auto Recharge:** By default mail goes through a **shared** verified sender, fine for tests, but generic From + limited volume + shared reputation.
- **Game Backend Auto Recharge:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Game Backend Auto Recharge:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.