import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { readFileSync, existsSync } from "node:fs";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACCEPTED_ASSETS, AGENT_PRIVATE_KEY, ATTRIBUTION_CODE, BUY_ENABLED, CAIP2, FACILITATOR_URL, FREE_PREVIEWS_PER_DAY,
  IDENTITY_REGISTRY, KYA_AGENT_ID, PAY_TO, PORT, PRICE_CHECK, PRICE_REPORT, PUBLIC_URL, X402_API_KEY, X402_NETWORK,
} from "./config.ts";
import { dbKind, getCheck, insertCheck, insertPayment, takePreview } from "./db.ts";
import { parseTarget, runCheck, toPreview, type CheckResult } from "./engine.ts";
import { stats } from "./stats.ts";

const app = new Hono();
app.use("/api/*", cors());
app.use("/v1/*", cors({ origin: "*", exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"] }));

const agentAddress = AGENT_PRIVATE_KEY.length === 66 ? privateKeyToAccount(AGENT_PRIVATE_KEY).address : null;
const payTo = PAY_TO ?? agentAddress;
const paywallOn = !!(payTo && X402_API_KEY);

// ---------------------------------------------------------------- x402 paywall
if (paywallOn) {
  const facilitator = new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
    createAuthHeaders: async () => {
      const h = { "X-API-Key": X402_API_KEY };
      return { verify: h, settle: h, supported: h };
    },
  });
  const server = new x402ResourceServer(facilitator);
  server.register("eip155:*", new ExactEvmScheme());
  // Log every settled payment: who paid, for what, and the settlement tx.
  server.onAfterSettle(async (ctx) => {
    const r = ctx.result;
    if (!r.success || !r.payer) return;
    const asset = ACCEPTED_ASSETS.find((a) => a.address.toLowerCase() === String(ctx.requirements.asset).toLowerCase());
    const amount = String(ctx.requirements.amount ?? "");
    await insertPayment({
      direction: "in",
      counterparty: r.payer,
      resource: (ctx.paymentPayload as { resource?: { url?: string } }).resource?.url,
      asset: asset?.symbol ?? String(ctx.requirements.asset),
      amount,
      usd: amount ? Number(amount) / 1e6 : undefined,
      tx: r.transaction,
      network: r.network,
    });
  });

  const accepts = (amount: string) =>
    ACCEPTED_ASSETS.map((a) => ({
      scheme: "exact" as const,
      network: CAIP2 as `${string}:${string}`,
      payTo: payTo!,
      price: { amount, asset: a.address, extra: { name: a.name, version: a.version } },
    }));

  app.use(
    paymentMiddleware(
      {
        "GET /v1/check/*": { accepts: accepts(PRICE_CHECK), description: "KYA check: trust verdict for a Celo agent wallet or ERC-8004 id", mimeType: "application/json" },
        "GET /v1/report/*": { accepts: accepts(PRICE_REPORT), description: "KYA report: check plus archive-state age, Chainstack data and a written summary", mimeType: "application/json" },
      },
      server,
    ),
  );
}

/** The payer of the current request, read from the x402 payment header (v2 or v1). */
function payerOf(c: Context): string | null {
  const raw = c.req.header("payment-signature") ?? c.req.header("x-payment");
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return p?.payload?.authorization?.from ?? p?.payload?.permit2Authorization?.from ?? null;
  } catch {
    return null;
  }
}

// Repeat checks on the same target within 2 minutes reuse the result.
const recent = new Map<string, { at: number; result: CheckResult }>();
async function cachedCheck(target: string, depth: "preview" | "check" | "report") {
  const key = `${depth}:${target.toLowerCase()}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < 120_000) return hit.result;
  const result = await runCheck(target, { depth });
  recent.set(key, { at: Date.now(), result });
  return result;
}

async function handleCheck(c: Context, depth: "check" | "report") {
  // Never give paid results away on mainnet because a key is missing.
  if (!paywallOn && X402_NETWORK === "mainnet") return c.json({ error: "paywall not configured" }, 503);
  if (!paywallOn) c.header("x-kya-mode", "unpaid-dev");
  const target = decodeURIComponent(c.req.path.split("/").slice(3).join("/"));
  if (!parseTarget(target)) return c.json({ error: "target must be a 0x address or an ERC-8004 agent id like 8004:123" }, 400);
  const t0 = Date.now();
  try {
    const result = await cachedCheck(target, depth);
    const id = await insertCheck({
      kind: depth, target, subject: result.subject, agentId: result.agent?.id, score: result.score, verdict: result.verdict,
      maxUsd: result.maxUsd, payer: payerOf(c), ms: Date.now() - t0, result,
    });
    return c.json({ id, ...result });
  } catch (e) {
    // A 4xx/5xx here means the x402 middleware does not settle: the caller is not charged.
    return c.json({ error: (e as Error).message }, 422);
  }
}

app.get("/v1/check/*", (c) => handleCheck(c, "check"));
app.get("/v1/report/*", (c) => handleCheck(c, "report"));

// ---------------------------------------------------------------- free routes
app.get("/api/preview/:target", async (c) => {
  const target = c.req.param("target");
  if (!parseTarget(target)) return c.json({ error: "Enter a 0x address or an agent id like 8004:123" }, 400);
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await takePreview(ip, FREE_PREVIEWS_PER_DAY))) return c.json({ error: `Free previews are limited to ${FREE_PREVIEWS_PER_DAY} a day. Use the paid API.` }, 429);
  const t0 = Date.now();
  try {
    const result = await cachedCheck(target, "check");
    await insertCheck({ kind: "preview", target, subject: result.subject, agentId: result.agent?.id, score: result.score, verdict: result.verdict, maxUsd: result.maxUsd, ms: Date.now() - t0, result });
    return c.json(toPreview(result));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.get("/api/stats", async (c) => c.json(await stats()));

app.get("/api/checks/:id", async (c) => {
  const row = await getCheck(Number(c.req.param("id")));
  if (!row) return c.json({ error: "not found" }, 404);
  const result = (typeof row.result === "string" ? JSON.parse(row.result) : row.result) as CheckResult;
  // Paid results stay private to the payer; the dashboard shows the preview shape.
  return c.json(row.kind === "preview" ? toPreview(result) : { ...toPreview(result), paid: true });
});

app.get("/api/config", (c) =>
  c.json({
    network: X402_NETWORK,
    caip2: CAIP2,
    facilitator: FACILITATOR_URL,
    paywall: paywallOn,
    payTo,
    agentWallet: agentAddress,
    agentId: KYA_AGENT_ID?.toString() ?? null,
    attributionCode: ATTRIBUTION_CODE,
    buyEnabled: BUY_ENABLED,
    prices: { check: Number(PRICE_CHECK) / 1e6, report: Number(PRICE_REPORT) / 1e6 },
    assets: ACCEPTED_ASSETS.map((a) => a.symbol),
    publicUrl: PUBLIC_URL,
  }),
);

// ERC-8004 registration file (served at the URI registered on-chain).
const registration = () => ({
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "KYA: Know Your Agent",
  description:
    "Pay-per-check trust verdicts for agent wallets on Celo. Send a wallet or ERC-8004 id, get pay / cap / refuse with the onchain evidence. $0.01 per check in USA₮, USDC or USD₮ over x402.",
  image: `${PUBLIC_URL}/icon.png`,
  services: [
    { name: "web", endpoint: PUBLIC_URL },
    { name: "x402", endpoint: `${PUBLIC_URL}/v1/check/{target}` },
    { name: "MCP", endpoint: `${PUBLIC_URL}/mcp-install`, version: "2025-06-18" },
    ...(agentAddress ? [{ name: "agentWallet", endpoint: `eip155:42220:${agentAddress}` }] : []),
  ],
  x402Support: true,
  active: true,
  supportedTrust: ["reputation"],
  registrations: KYA_AGENT_ID ? [{ agentId: Number(KYA_AGENT_ID), agentRegistry: `eip155:42220:${IDENTITY_REGISTRY}` }] : [],
});
app.get("/agent.json", (c) => c.json(registration()));
app.get("/.well-known/agent-registration.json", (c) => c.json(registration()));

app.get("/health", (c) => c.json({ ok: true, db: dbKind }));

// ---------------------------------------------------------------- web app (built by vite)
if (existsSync("dist/index.html")) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", (c) => c.html(readFileSync("dist/index.html", "utf8")));
}

// Behind a TLS-terminating proxy (Railway) the request arrives as http://; x402 advertises the
// request URL as the resource, so restore the scheme the caller actually used.
const fetchBehindProxy = (req: Request) => {
  if (req.headers.get("x-forwarded-proto") === "https" && req.url.startsWith("http:")) {
    req = new Request(`https:${req.url.slice(5)}`, req);
  }
  return app.fetch(req);
};

serve({ fetch: fetchBehindProxy, port: PORT }, () => {
  console.log(`KYA on ${PUBLIC_URL} (${X402_NETWORK}) paywall=${paywallOn ? "on" : "OFF: set X402_API_KEY and AGENT_PRIVATE_KEY/PAY_TO"} buy=${BUY_ENABLED ? "on" : "off"}`);
});
