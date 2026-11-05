/**
 * Paying for services we don't own: Chainstack Celo RPC and Cencori inference,
 * bought per call over x402 through the buy gateway (gateway.usebuy.ai).
 * One wallet (the KYA agent wallet) pays; every outgoing payment is logged.
 */
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_PRIVATE_KEY, BUY_ENABLED, BUY_GATEWAY, FORNO } from "./config.ts";
import { insertPayment } from "./db.ts";

let payFetch: typeof fetch | null = null;

function getPayFetch(): typeof fetch {
  if (payFetch) return payFetch;
  const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
  const client = new x402Client();
  // Hard cap: no single service call may cost more than 5 cents.
  client.setSpendControls({ maxAmountPerPayment: "$0.05" });
  client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: FORNO }));
  payFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return payFetch;
}

export function decodePaymentResponse(res: Response): { transaction?: string; payer?: string; network?: string } | null {
  const raw = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** POST JSON to a paid buy-gateway route. Never retried: a retry can be a second payment. */
export async function buyPost<T>(path: string, body: unknown, service: string, usd: number): Promise<T> {
  if (!BUY_ENABLED) throw new Error("buy is not enabled (set BUY_ENABLED=1 and AGENT_PRIVATE_KEY)");
  const res = await getPayFetch()(`${BUY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const receipt = decodePaymentResponse(res);
  if (receipt?.transaction) {
    await insertPayment({
      direction: "out",
      counterparty: service,
      resource: `${BUY_GATEWAY}${path}`,
      usd,
      tx: receipt.transaction,
      network: receipt.network,
    });
  }
  if (!res.ok) throw new Error(`${service} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export type RpcCall = { method: string; params: unknown[] };

/**
 * One JSON-RPC batch. With buy enabled it is a single paid Chainstack call ($0.01 for up to 2000
 * requests); otherwise it goes to the public Forno endpoint.
 */
export async function rpcBatch(calls: RpcCall[], opts: { paid: boolean }): Promise<{ results: unknown[]; source: string }> {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
  let raw: Array<{ id: number; result?: unknown; error?: unknown }>;
  let source: string;
  if (opts.paid && BUY_ENABLED) {
    raw = await buyPost("/chainstack/celo", body, "chainstack.celo", 0.01);
    source = "chainstack (paid via buy)";
  } else {
    // Forno refuses batches above ~50 calls and archive reads are slow: chunks of 16, four at a time.
    const chunks: (typeof body)[] = [];
    for (let i = 0; i < body.length; i += 16) chunks.push(body.slice(i, i + 16));
    raw = [];
    for (let i = 0; i < chunks.length; i += 4) {
      const parts = await Promise.all(
        chunks.slice(i, i + 4).map(async (chunk) => {
          const res = await fetch(FORNO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chunk), signal: AbortSignal.timeout(20000) });
          const j = await res.json().catch(() => null);
          return Array.isArray(j) ? j : [];
        }),
      );
      raw.push(...parts.flat());
    }
    source = "forno";
  }
  const byId = new Map(raw.map((r) => [r.id, r]));
  return { results: calls.map((_, i) => byId.get(i)?.result ?? null), source };
}

/** Short written risk summary from Cencori ($0.01 per call through buy). */
export async function summarize(prompt: string): Promise<string | null> {
  if (!BUY_ENABLED) return null;
  const out = await buyPost<{ choices?: Array<{ message?: { content?: string } }> }>(
    "/cencori/v1/chat/completions",
    {
      model: "maximo-atlas-1.3",
      max_tokens: 256,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You assess whether an AI agent wallet on Celo is safe to pay. Write 2-3 plain sentences for another agent's operator. Use only the facts given. No hype, no markdown.",
        },
        { role: "user", content: prompt },
      ],
    },
    "cencori.v1.chat.completions",
    0.01,
  );
  return out.choices?.[0]?.message?.content?.trim() ?? null;
}
