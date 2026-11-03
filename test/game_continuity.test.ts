import assert from "node:assert/strict";
import test from "node:test";
import { decideContinuityPriority, rechargeEventSchema } from "../src/game_continuity.js";

test("a recharge keeps the moderation queue moving before other game work", () => {
  const event = rechargeEventSchema.parse({
    balance_after: 40,
    recharge_amount: 25,
    notification_to: "oncall@example.com",
    player_assets: { pending_processing: 18 },
    live_events: { active_sessions: 240 },
    moderation_queue: { pending_items: 7 }
  });

  const decision = decideContinuityPriority(event);

  assert.equal(decision.priority, "moderation");
  assert.match(decision.summary, /7 moderation items/);
});

test("unknown request fields are rejected at the service boundary", () => {
  const result = rechargeEventSchema.safeParse({
    balance_after: 40,
    recharge_amount: 25,
    notification_to: "oncall@example.com",
    player_assets: { pending_processing: 18 },
    live_events: { active_sessions: 240 },
    moderation_queue: { pending_items: 0 },
    unexpected: true
  });

  assert.equal(result.success, false);
});
