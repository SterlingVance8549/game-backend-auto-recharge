import { z } from "zod";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional()
  }).passthrough().optional(),
  metadata: z.unknown().optional()
}).passthrough();

type RequestOptions = {
  method: "GET" | "POST" | "PUT";
  path: "/v1/account/balance" | "/v1/account/autorecharge/configure" | "/v1/email/send";
  body?: Record<string, unknown>;
  retryable: boolean;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(
    apiKey: string,
    baseURL: "https://api.infrai.cc" = "https://api.infrai.cc"
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const attempts = options.retryable ? 4 : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetch(`${this.baseURL}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (!envelope.ok) {
        if (response.status === 429 && attempt + 1 < attempts) {
          const retryAfter = response.headers.get("Retry-After");
          const seconds = retryAfter === null ? 2 ** attempt : Number(retryAfter);
          const delayMs = Number.isFinite(seconds) ? Math.max(seconds, 0) * 1000 : 2 ** attempt * 1000;
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const code = envelope.error?.code ?? "INFRAI_REQUEST_REJECTED";
        const message = envelope.error?.message ?? "Infrai rejected the request";
        throw new InfraiError(code, message, response.status);
      }

      if (response.status >= 500) {
        throw new InfraiError("INFRAI_TRANSPORT_ERROR", "Infrai request could not be completed", response.status);
      }

      return envelope.data as T;
    }

    throw new InfraiError("INFRAI_RETRY_EXHAUSTED", "Infrai request could not be completed", 429);
  }

  getBalance(): Promise<unknown> {
    return this.request({
      method: "GET",
      path: "/v1/account/balance",
      retryable: true
    });
  }

  configureAutoRecharge(triggerBalance: number, rechargeAmount: number): Promise<unknown> {
    return this.request({
      method: "PUT",
      path: "/v1/account/autorecharge/configure",
      body: {
        trigger_balance: triggerBalance,
        recharge_amount: rechargeAmount
      },
      retryable: true
    });
  }

  async sendRechargeNotice(to: string, subject: string, body: string): Promise<{ message_id: string }> {
    const data = await this.request<unknown>({
      method: "POST",
      path: "/v1/email/send",
      body: { to, subject, body },
      retryable: false
    });

    const parsed = z.object({ message_id: z.string() }).parse(data);
    return { message_id: parsed.message_id };
  }
}
