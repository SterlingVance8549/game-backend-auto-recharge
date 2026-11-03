import { z } from "zod";

export const continuityPolicySchema = z.object({
  trigger_balance: z.number().nonnegative(),
  recharge_amount: z.number().positive()
}).strict();

export const rechargeEventSchema = z.object({
  balance_after: z.number().nonnegative(),
  recharge_amount: z.number().positive(),
  notification_to: z.string().email(),
  player_assets: z.object({
    pending_processing: z.number().int().nonnegative()
  }).strict(),
  live_events: z.object({
    active_sessions: z.number().int().nonnegative()
  }).strict(),
  moderation_queue: z.object({
    pending_items: z.number().int().nonnegative()
  }).strict()
}).strict();

export type RechargeEvent = z.infer<typeof rechargeEventSchema>;

export type ContinuityDecision = {
  priority: "moderation" | "live-events" | "asset-processing";
  summary: string;
};

export function decideContinuityPriority(event: RechargeEvent): ContinuityDecision {
  if (event.moderation_queue.pending_items > 0) {
    return {
      priority: "moderation",
      summary: `Recharge recorded; keep ${event.moderation_queue.pending_items} moderation items moving first.`
    };
  }

  if (event.live_events.active_sessions > 0) {
    return {
      priority: "live-events",
      summary: `Recharge recorded; protect ${event.live_events.active_sessions} active game sessions first.`
    };
  }

  return {
    priority: "asset-processing",
    summary: `Recharge recorded; continue processing ${event.player_assets.pending_processing} player assets.`
  };
}
