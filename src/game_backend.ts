import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  continuityPolicySchema,
  decideContinuityPriority,
  rechargeEventSchema
} from "./game_continuity.js";
import { InfraiClient, InfraiError } from "./infrai.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) {
  throw new Error("INFRAI_API_KEY is required");
}

const infrai = new InfraiClient(apiKey);

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      reply(response, 200, { ok: true });
      return;
    }

    if (request.method === "PUT" && request.url === "/continuity-policy") {
      const policy = continuityPolicySchema.parse(await readJson(request));
      const [configuration, balance] = await Promise.all([
        infrai.configureAutoRecharge(policy.trigger_balance, policy.recharge_amount),
        infrai.getBalance()
      ]);
      reply(response, 200, { ok: true, configuration, balance });
      return;
    }

    if (request.method === "POST" && request.url === "/recharge-fired") {
      const event = rechargeEventSchema.parse(await readJson(request));
      const decision = decideContinuityPriority(event);
      const notice = await infrai.sendRechargeNotice(
        event.notification_to,
        "Game backend recharge completed",
        `${decision.summary} Balance after recharge: ${event.balance_after}. Recharge amount: ${event.recharge_amount}.`
      );
      reply(response, 200, { ok: true, decision, message_id: notice.message_id });
      return;
    }

    reply(response, 404, { ok: false, error: "route_not_found" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      reply(response, 400, { ok: false, error: "invalid_request" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      reply(response, status, { ok: false, error: error.code, message: error.message });
      return;
    }
    reply(response, 500, { ok: false, error: "internal_error" });
  }
});

const port = Number(process.env.PORT ?? "3000");
server.listen(port, () => {
  console.log(`Game continuity service listening on http://localhost:${port}`);
});
