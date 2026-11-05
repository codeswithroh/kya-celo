/**
 * KYA MCP server (stdio). Gives any coding or runtime agent three tools:
 *   kya_preview  free, verdict + score only
 *   kya_check    $0.01, every signal with evidence
 *   kya_report   $0.05, adds Chainstack archive reads and a written summary
 * Paid tools sign x402 payments with KYA_PAYER_KEY (your agent's own wallet, holding USA₮/USDC/USD₮).
 *
 *   claude mcp add kya -e KYA_URL=https://… -e KYA_PAYER_KEY=0x… -- npx tsx mcp/server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const BASE = (process.env.KYA_URL ?? "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.KYA_PAYER_KEY as `0x${string}` | undefined;

let payFetch: typeof fetch | null = null;
function paid(): typeof fetch {
  if (!KEY) throw new Error("Set KYA_PAYER_KEY to a wallet holding USA₮, USDC or USD₮ on Celo to use paid checks.");
  if (!payFetch) {
    const client = new x402Client();
    client.setSpendControls({ maxAmountPerPayment: "$0.10" }); // KYA never costs more than this
    client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(KEY), { rpcUrl: "https://forno.celo.org" }));
    payFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  }
  return payFetch;
}

const target = z.string().describe("Wallet address (0x…) or ERC-8004 agent id (e.g. 8004:123) of the agent you are about to pay");
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: "kya", version: "0.1.0" });

server.tool("kya_preview", "Free trust verdict (pay / cap / refuse) and score for a Celo agent wallet. Rate limited.", { target }, async ({ target }) => {
  const res = await fetch(`${BASE}/api/preview/${encodeURIComponent(target)}`);
  return text(await res.json());
});

server.tool(
  "kya_check",
  "Paid ($0.01) check before paying another agent: verdict, max safe payment in USD, and every signal with its onchain evidence.",
  { target },
  async ({ target }) => {
    const res = await paid()(`${BASE}/v1/check/${encodeURIComponent(target)}`);
    return text({ status: res.status, receipt: res.headers.get("payment-response"), body: await res.json() });
  },
);

server.tool(
  "kya_report",
  "Paid ($0.05) deep report: the check plus finer wallet-age sampling and a written risk summary.",
  { target },
  async ({ target }) => {
    const res = await paid()(`${BASE}/v1/report/${encodeURIComponent(target)}`);
    return text({ status: res.status, receipt: res.headers.get("payment-response"), body: await res.json() });
  },
);

await server.connect(new StdioServerTransport());
