/**
 * The check engine. Given a wallet address or an ERC-8004 agent id, gather onchain evidence
 * from Celo mainnet and turn it into a verdict another agent can act on:
 *   pay    -> go ahead, up to maxUsd per payment
 *   cap    -> pay small amounts only (maxUsd), or pay after delivery
 *   refuse -> do not prepay this wallet
 */
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";
import { fromDataSuffix } from "@celo/attribution-tags";
import { BLOCKSCOUT, IDENTITY_REGISTRY, REPUTATION_REGISTRY, SCAN_8004, TOKENS } from "./config.ts";
import { rpcBatch, summarize, type RpcCall } from "./buy.ts";

export type Status = "good" | "warn" | "bad" | "info";
export type Signal = { key: string; label: string; status: Status; points: number; detail: string };
export type Verdict = "pay" | "cap" | "refuse";

export type CheckResult = {
  target: string;
  subject: Address | null;
  agent: null | {
    id: string;
    name: string | null;
    owner: string | null;
    wallet: string | null;
    x402: boolean;
    services: Record<string, unknown> | null;
    feedbackCount: number;
    averageScore: number | null;
  };
  score: number;
  verdict: Verdict;
  maxUsd: number;
  reason: string;
  signals: Signal[];
  facts: {
    firstSeen: string | null;
    ageDays: number | null;
    txCount: number;
    tokenTransfers: number;
    counterparties: number;
    funder: string | null;
    funderFanout: number | null;
    payersIn: number;
    repeatPayers: number;
    relayedPaymentsOut: number;
    attributionCodes: string[];
    isContract: boolean;
    flaggedScam: boolean;
    balances: Record<string, string>;
    historyComplete: boolean;
  };
  summary?: string | null;
  sources: string[];
  checkedAt: string;
};

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const identity = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getAgentWallet(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
]);
const reputation = parseAbi(["function getClients(uint256) view returns (address[])"]);

type BsTx = { hash: string; from: string; to: string; timeStamp: string; input?: string; value: string; isError?: string };
type BsTokenTx = BsTx & { contractAddress: string; tokenSymbol: string; tokenDecimal: string };

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 5 * 60_000;
let bsChain: Promise<unknown> = Promise.resolve();
let bsBlockedUntil = 0;
const BS_KEY = process.env.BLOCKSCOUT_API_KEY ?? "";

/** Blockscout's free API allows a few requests per second: serialize, space and retry on 429. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = bsChain.then(fn, fn);
  bsChain = run.then(() => sleep(220), () => sleep(220));
  return run;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, ms = 8000): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;
  const isBs = url.startsWith(BLOCKSCOUT);
  if (isBs && Date.now() < bsBlockedUntil) return null;
  if (isBs && BS_KEY) url += `${url.includes("?") ? "&" : "?"}apikey=${BS_KEY}`;
  const once = async (): Promise<{ ok: boolean; retry: boolean; data: T | null }> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
      if (res.status === 429) return { ok: false, retry: true, data: null };
      if (!res.ok) return { ok: false, retry: res.status >= 500, data: null };
      return { ok: true, retry: false, data: (await res.json()) as T };
    } catch {
      return { ok: false, retry: true, data: null };
    }
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = isBs ? await throttled(once) : await once();
    if (r.ok) {
      cache.set(url, { at: Date.now(), data: r.data });
      return r.data;
    }
    if (!r.retry) return null;
    if (attempt === 1 && isBs) break;
    await sleep(500 * (attempt + 1));
  }
  // Rate limited: stop asking Blockscout for a minute so checks stay fast.
  if (isBs) bsBlockedUntil = Date.now() + 60_000;
  return null;
}

/** null means the history could not be fetched (rate limit, outage), which is not the same as empty. */
async function bsList<T>(action: "txlist" | "tokentx", address: string, sort: "asc" | "desc", n: number): Promise<T[] | null> {
  const j = await getJson<{ result: T[] | string | null; message?: string }>(
    `${BLOCKSCOUT}/api?module=account&action=${action}&address=${address}&sort=${sort}&page=1&offset=${n}`,
  );
  if (!j) return null;
  if (Array.isArray(j.result)) return j.result;
  return /no (transactions|token transfers) found/i.test(j.message ?? "") ? [] : null;
}

type ScanAgent = {
  token_id: string; name: string | null; owner_address: string | null; agent_wallet?: string | null;
  x402_supported: boolean; services?: Record<string, unknown> | null; total_feedbacks?: number; average_score?: number;
};

/** Parse "0xabc…", "8004:123", "#123" or "123". */
export function parseTarget(raw: string): { address?: Address; agentId?: bigint } | null {
  const t = raw.trim();
  if (isAddress(t, { strict: false })) return { address: getAddress(t) };
  const m = t.match(/^(?:8004:|#|agent:)?(\d{1,12})$/i);
  if (m) return { agentId: BigInt(m[1]) };
  return null;
}

async function resolveAgent(agentId: bigint) {
  const scan = await getJson<ScanAgent>(`${SCAN_8004}/agents/42220/${agentId}`);
  if (scan?.token_id) return scan;
  // Fallback: read the registry directly.
  const calls: RpcCall[] = [
    { method: "eth_call", params: [{ to: IDENTITY_REGISTRY, data: encodeFunctionData({ abi: identity, functionName: "ownerOf", args: [agentId] }) }, "latest"] },
    { method: "eth_call", params: [{ to: IDENTITY_REGISTRY, data: encodeFunctionData({ abi: identity, functionName: "getAgentWallet", args: [agentId] }) }, "latest"] },
  ];
  const { results } = await rpcBatch(calls, { paid: false });
  const dec = (fn: "ownerOf" | "getAgentWallet", r: unknown) => {
    try { return decodeFunctionResult({ abi: identity, functionName: fn, data: r as Hex }) as string; } catch { return null; }
  };
  const owner = dec("ownerOf", results[0]);
  if (!owner) return null;
  return { token_id: agentId.toString(), name: null, owner_address: owner, agent_wallet: dec("getAgentWallet", results[1]), x402_supported: false } as ScanAgent;
}

async function agentsOwnedBy(address: Address): Promise<ScanAgent[]> {
  const j = await getJson<{ items: ScanAgent[] }>(`${SCAN_8004}/agents?chain_id=42220&owner_address=${address.toLowerCase()}&limit=5`);
  return j?.items ?? [];
}

const DAY = 86_400_000;
let headCache = { at: 0, n: 0 };
async function chainHead(): Promise<number> {
  if (Date.now() - headCache.at < 30_000) return headCache.n;
  const { results } = await rpcBatch([{ method: "eth_blockNumber", params: [] }], { paid: false }).catch(() => ({ results: [null] }));
  const n = results[0] ? Number(BigInt(results[0] as string)) : 0;
  if (n) headCache = { at: Date.now(), n };
  return n;
}
// Historical token reads are slow on public RPC; free checks probe nonce + CELO only.
const AGE_TOKENS_PAID: Address[] = ["0xcebA9300f2b948710d2653dD7B07f33A8B32118C", "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"];

/**
 * First block where the wallet had a nonce or a balance, found by sampling archive state:
 * 16 evenly spaced blocks, then 16 more inside the bracket that flipped (~4 days of precision on Celo).
 * Free checks read Forno; paid reports read Chainstack through buy, which allows 32x32 sampling.
 */
async function probeFirstSeen(subject: Address, head: number, paid: boolean): Promise<{ block: number; ts: number } | null> {
  const tokens = paid ? AGE_TOKENS_PAID : [];
  const probe = async (blocks: number[]) => {
    const calls: RpcCall[] = [];
    for (const b of blocks) {
      const tag = `0x${b.toString(16)}`;
      calls.push({ method: "eth_getTransactionCount", params: [subject, tag] });
      calls.push({ method: "eth_getBalance", params: [subject, tag] });
      for (const t of tokens) calls.push({ method: "eth_call", params: [{ to: t, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [subject] }) }, tag] });
    }
    const { results } = await rpcBatch(calls, { paid });
    const per = 2 + tokens.length;
    return blocks.map((_, i) => results.slice(i * per, i * per + per).some((x) => typeof x === "string" && x !== "0x" && /[1-9a-f]/i.test(x.slice(2))));
  };
  const N = paid ? 32 : 16;
  const coarse = Array.from({ length: N }, (_, i) => Math.floor((head * (i + 1)) / N));
  const hit = await probe(coarse);
  const idx = hit.findIndex(Boolean);
  if (idx === -1) return null;
  const lo = idx === 0 ? 0 : coarse[idx - 1];
  const hi = coarse[idx];
  const fine = Array.from({ length: N }, (_, i) => Math.floor(lo + ((hi - lo) * (i + 1)) / N));
  const hit2 = await probe(fine);
  const block = fine[Math.max(0, hit2.findIndex(Boolean))];
  const { results } = await rpcBatch([{ method: "eth_getBlockByNumber", params: [`0x${block.toString(16)}`, false] }], { paid: false });
  const ts = Number(BigInt((results[0] as { timestamp?: string } | null)?.timestamp ?? "0x0"));
  return ts ? { block, ts } : null;
}

export async function runCheck(rawTarget: string, opts: { depth: "preview" | "check" | "report" }): Promise<CheckResult> {
  const parsed = parseTarget(rawTarget);
  if (!parsed) throw new Error("target must be a 0x address or an ERC-8004 agent id like 8004:123");
  const sources = new Set<string>(["8004scan"]);

  // 1. Resolve the subject wallet and its ERC-8004 identity.
  let agent: ScanAgent | null = null;
  let subject: Address | null = null;
  if (parsed.agentId !== undefined) {
    agent = await resolveAgent(parsed.agentId);
    if (!agent) throw new Error(`agent ${parsed.agentId} is not registered in the Celo ERC-8004 identity registry`);
    const w = agent.agent_wallet && agent.agent_wallet !== "0x0000000000000000000000000000000000000000" ? agent.agent_wallet : agent.owner_address;
    subject = w ? getAddress(w) : null;
  } else {
    subject = parsed.address!;
    const owned = await agentsOwnedBy(subject);
    agent = owned[0] ?? null;
  }
  if (!subject) throw new Error("could not resolve a wallet for this target");

  // 2. History from Blockscout (free) in parallel with one RPC batch (paid Chainstack in reports).
  const rpcCalls: RpcCall[] = [
    { method: "eth_getCode", params: [subject, "latest"] },
    { method: "eth_getTransactionCount", params: [subject, "latest"] },
    { method: "eth_getBalance", params: [subject, "latest"] },
    { method: "eth_blockNumber", params: [] },
    ...TOKENS.map((t) => ({ method: "eth_call", params: [{ to: t.address, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [subject!] }) }, "latest"] })),
    { method: "eth_call", params: [{ to: IDENTITY_REGISTRY, data: encodeFunctionData({ abi: identity, functionName: "balanceOf", args: [subject] }) }, "latest"] },
    ...(agent ? [{ method: "eth_call", params: [{ to: REPUTATION_REGISTRY, data: encodeFunctionData({ abi: reputation, functionName: "getClients", args: [BigInt(agent.token_id)] }) }, "latest"] }] : []),
  ];

  const headNow = await chainHead();
  const [rpc, probed, firstTxR, firstTokR, recentTxR, recentTokR, bsAddr] = await Promise.all([
    rpcBatch(rpcCalls, { paid: opts.depth === "report" }),
    // Age comes from archive state (works without an explorer); Blockscout's first tx refines it when reachable.
    opts.depth === "preview" || !headNow ? Promise.resolve(null) : probeFirstSeen(subject, headNow, opts.depth === "report").catch(() => null),
    bsList<BsTx>("txlist", subject, "asc", 1),
    bsList<BsTokenTx>("tokentx", subject, "asc", 1),
    bsList<BsTx>("txlist", subject, "desc", opts.depth === "preview" ? 50 : 200),
    bsList<BsTokenTx>("tokentx", subject, "desc", opts.depth === "preview" ? 50 : 200),
    getJson<{ is_contract?: boolean; is_scam?: boolean; reputation?: string }>(`${BLOCKSCOUT}/api/v2/addresses/${subject}`),
  ]);
  sources.add(rpc.source);
  const historyOk = [firstTxR, firstTokR, recentTxR, recentTokR].every((x) => x !== null);
  if (historyOk) sources.add("blockscout");
  const firstTx = firstTxR ?? [], firstTok = firstTokR ?? [], recentTx = recentTxR ?? [], recentTok = recentTokR ?? [];
  const r = rpc.results;
  const code = (r[0] as string) ?? "0x";
  const nonce = Number(BigInt((r[1] as string) ?? "0x0"));
  const balances: Record<string, string> = { CELO: fmt(BigInt((r[2] as string) ?? "0x0"), 18) };
  const head = Number(BigInt((r[3] as string) ?? "0x0"));
  r.splice(3, 1);
  TOKENS.forEach((t, i) => {
    const raw = r[3 + i] as string | null;
    const v = raw && raw !== "0x" ? BigInt(raw) : 0n;
    if (v > 0n) balances[t.symbol] = fmt(v, t.decimals);
  });
  const owned8004 = (() => { const x = r[3 + TOKENS.length] as string | null; return x && x !== "0x" ? Number(BigInt(x)) : 0; })();
  let raters = 0;
  if (agent) {
    try {
      raters = (decodeFunctionResult({ abi: reputation, functionName: "getClients", data: r[4 + TOKENS.length] as Hex }) as readonly string[]).length;
    } catch { /* unrated */ }
  }

  // 3. Derive facts.
  const me = subject.toLowerCase();
  const firstTimes = [firstTx[0]?.timeStamp, firstTok[0]?.timeStamp, probed?.ts].filter(Boolean).map(Number);
  const firstSeenMs = firstTimes.length ? Math.min(...firstTimes) * 1000 : null;
  const ageDays = firstSeenMs ? (Date.now() - firstSeenMs) / DAY : null;

  // Funder: whoever sent the first inbound value (CELO or token) to this wallet.
  const inbound = [
    ...(firstTx[0] && firstTx[0].to?.toLowerCase() === me && firstTx[0].value !== "0" ? [firstTx[0]] : []),
    ...(firstTok[0] && firstTok[0].to?.toLowerCase() === me ? [firstTok[0]] : []),
  ].sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
  const funder = inbound[0]?.from?.toLowerCase() ?? (firstTx[0] && firstTx[0].from.toLowerCase() !== me ? firstTx[0].from.toLowerCase() : null);

  const counterparties = new Set<string>();
  for (const t of recentTx) for (const a of [t.from, t.to]) if (a && a.toLowerCase() !== me) counterparties.add(a.toLowerCase());
  for (const t of recentTok) for (const a of [t.from, t.to]) if (a && a.toLowerCase() !== me) counterparties.add(a.toLowerCase());

  const sentHashes = new Set(recentTx.filter((t) => t.from.toLowerCase() === me).map((t) => t.hash));
  const usdSet = new Set(TOKENS.map((t) => t.address.toLowerCase()));
  const stableTok = recentTok.filter((t) => usdSet.has(t.contractAddress.toLowerCase()));
  // Signed payments someone else submitted (x402 / EIP-3009 / Permit2 style): the wallet paid without sending a tx.
  const relayedPaymentsOut = stableTok.filter((t) => t.from.toLowerCase() === me && !sentHashes.has(t.hash)).length;
  const payerCounts = new Map<string, number>();
  for (const t of stableTok) if (t.to.toLowerCase() === me && t.from.toLowerCase() !== me) payerCounts.set(t.from.toLowerCase(), (payerCounts.get(t.from.toLowerCase()) ?? 0) + 1);
  const repeatPayers = [...payerCounts.values()].filter((n) => n > 1).length;

  const codes = new Set<string>();
  for (const t of recentTx) {
    if (t.from.toLowerCase() !== me || !t.input || t.input.length < 40) continue;
    try { fromDataSuffix(t.input as Hex)?.codes.forEach((c: string) => codes.add(c)); } catch { /* not tagged */ }
  }

  // Funder fan-out: how many distinct wallets did the funder seed recently? Farms seed dozens.
  let funderFanout: number | null = null;
  let funderIsContract = false;
  if (funder && opts.depth !== "preview") {
    const [fTxR, fTokR, fAddr] = await Promise.all([
      bsList<BsTx>("txlist", funder, "desc", 200),
      bsList<BsTokenTx>("tokentx", funder, "desc", 200),
      getJson<{ is_contract?: boolean }>(`${BLOCKSCOUT}/api/v2/addresses/${funder}`),
    ]);
    // EIP-7702 delegated EOAs carry code too (0xef0100…); only count real contracts.
    const fCode = await rpcBatch([{ method: "eth_getCode", params: [funder, "latest"] }], { paid: false }).then((x) => (x.results[0] as string) ?? "0x").catch(() => "0x");
    const fTx = fTxR ?? [], fTok = fTokR ?? [];
    funderIsContract = !!fAddr?.is_contract && !fCode.startsWith("0xef0100") && fCode.length > 2;
    const seeded = new Set<string>();
    for (const t of [...fTx, ...fTok]) if (t.from.toLowerCase() === funder && t.to && t.to.toLowerCase() !== funder) seeded.add(t.to.toLowerCase());
    funderFanout = fTxR && fTokR ? seeded.size : null;
  }

  // 4. Score.
  const signals: Signal[] = [];
  const add = (s: Signal) => signals.push(s);
  const flaggedScam = !!bsAddr?.is_scam;
  const isDelegated = code.startsWith("0xef0100");
  const isContract = code !== "0x" && code.length > 2 && !isDelegated;

  if (flaggedScam) add({ key: "scam", label: "Explorer scam flag", status: "bad", points: -60, detail: "Blockscout marks this address as a scam." });

  if (agent) {
    add({ key: "identity", label: "ERC-8004 identity", status: "good", points: 15, detail: `Registered as agent #${agent.token_id}${agent.name ? ` (${agent.name})` : ""}.` });
    if (agent.x402_supported) add({ key: "x402", label: "Declares x402 endpoints", status: "good", points: 3, detail: "Registration file says its endpoints accept x402." });
  } else if (owned8004 > 0) {
    add({ key: "identity", label: "ERC-8004 identity", status: "good", points: 12, detail: `Owns ${owned8004} agent identity NFT(s).` });
  } else {
    add({ key: "identity", label: "ERC-8004 identity", status: "warn", points: -5, detail: "No agent identity found for this wallet." });
  }

  const fb = agent?.total_feedbacks ?? 0;
  if (agent && (fb > 0 || raters > 0)) {
    // 8004scan reports 0 when it has not computed an average; treat that as unknown.
    const avg = agent.average_score ? agent.average_score : null;
    const status: Status = avg === null ? "info" : avg >= 70 ? "good" : avg >= 40 ? "warn" : "bad";
    add({ key: "reputation", label: "Reputation", status, points: status === "good" ? 10 : status === "bad" ? -15 : 0,
      detail: `${Math.max(fb, raters)} rater(s)${avg !== null ? `, average ${avg.toFixed(0)}/100` : ""}. Raters are not vetted by the registry.` });
  } else if (agent) {
    add({ key: "reputation", label: "Reputation", status: "info", points: 0, detail: "No feedback on the reputation registry yet." });
  }

  if (!historyOk) {
    add({ key: "history", label: "History", status: "info", points: 0, detail: "Explorer history unavailable right now; counterparty and payment signals were skipped, not penalised." });
  }
  if (ageDays === null && nonce === 0) {
    add({ key: "age", label: "Wallet age", status: "bad", points: -20, detail: "No activity on Celo mainnet." });
  } else if (ageDays === null) {
    add({ key: "age", label: "Wallet age", status: "info", points: 0, detail: `${nonce} sent tx; first-seen date unavailable.` });
  } else {
    const d = ageDays;
    const [status, points]: [Status, number] = d < 1 ? ["bad", -15] : d < 7 ? ["warn", -6] : d < 30 ? ["info", 0] : d < 180 ? ["good", 8] : ["good", 12];
    add({ key: "age", label: "Wallet age", status, points, detail: `First seen ${new Date(firstSeenMs!).toISOString().slice(0, 10)} (${fmtDays(d)} ago).` });
  }

  const activity = nonce + recentTok.length;
  if (historyOk) add({ key: "activity", label: "Activity", status: activity >= 20 ? "good" : activity >= 3 ? "info" : "warn", points: activity >= 20 ? 5 : activity >= 3 ? 0 : -5,
    detail: `${nonce} sent tx, ${recentTok.length >= 200 ? "200+" : recentTok.length} token transfers, ${counterparties.size} counterparties.` });

  if (funder) {
    if (funderIsContract) {
      add({ key: "funding", label: "Funding source", status: "good", points: 3, detail: `First funded by contract ${short(funder)} (bridge, exchange or wallet factory).` });
    } else if (funderFanout !== null && funderFanout >= 25) {
      add({ key: "funding", label: "Funding source", status: "warn", points: -8, detail: `Funder ${short(funder)} seeded ${funderFanout} wallets recently: a faucet, a payroll wallet or a wallet farm.` });
    } else if (funderFanout !== null && funderFanout >= 10) {
      add({ key: "funding", label: "Funding source", status: "info", points: -3, detail: `Funder ${short(funder)} seeded ${funderFanout} wallets recently.` });
    } else {
      add({ key: "funding", label: "Funding source", status: "info", points: 0, detail: `First funded by ${short(funder)}${funderFanout !== null ? `, which seeded ${funderFanout} wallet(s) recently` : ""}.` });
    }
  }

  if (payerCounts.size > 0) {
    const good = payerCounts.size >= 3;
    add({ key: "earning", label: "Gets paid by others", status: good ? "good" : "info", points: good ? 8 + (repeatPayers > 0 ? 4 : 0) : 2,
      detail: `${payerCounts.size} distinct payer(s) sent stablecoins, ${repeatPayers} paid more than once.` });
  }
  if (relayedPaymentsOut > 0) {
    add({ key: "paying", label: "Pays by signature", status: "good", points: 4, detail: `${relayedPaymentsOut} signed stablecoin payment(s) settled by a relayer, typical of x402 buyers.` });
  }
  if (codes.size > 0) {
    add({ key: "attribution", label: "Attribution tags", status: "good", points: 3, detail: `Tags its transactions (ERC-8021): ${[...codes].slice(0, 3).join(", ")}.` });
  }
  if (isDelegated) add({ key: "contract", label: "Account type", status: "info", points: 0, detail: "EOA with an EIP-7702 delegation (smart-account features)." });
  if (isContract) add({ key: "contract", label: "Smart account", status: "info", points: 0, detail: "Address has contract code (smart wallet or service contract)." });

  const score = clamp(Math.round(50 + signals.reduce((s, x) => s + x.points, 0)), 0, 100);
  const verdict: Verdict = flaggedScam || score < 45 ? "refuse" : score < 70 ? "cap" : "pay";
  const maxUsd = verdict === "refuse" ? 0 : verdict === "cap" ? (score >= 60 ? 5 : 1) : score >= 85 ? 100 : 25;
  const worst = [...signals].sort((a, b) => a.points - b.points)[0];
  const best = [...signals].sort((a, b) => b.points - a.points)[0];
  const reason =
    verdict === "refuse"
      ? `Do not prepay. ${worst?.detail ?? ""}`
      : verdict === "cap"
        ? `Pay up to $${maxUsd} per payment, or pay after delivery. ${worst && worst.points < 0 ? worst.detail : ""}`.trim()
        : `Safe to pay up to $${maxUsd} per payment. ${best?.detail ?? ""}`;

  const result: CheckResult = {
    target: rawTarget,
    subject,
    agent: agent
      ? {
          id: agent.token_id, name: agent.name, owner: agent.owner_address, wallet: agent.agent_wallet ?? null,
          x402: !!agent.x402_supported, services: (agent.services as Record<string, unknown>) ?? null,
          feedbackCount: Math.max(fb, raters), averageScore: agent.average_score ?? null,
        }
      : null,
    score, verdict, maxUsd, reason, signals,
    facts: {
      firstSeen: firstSeenMs ? new Date(firstSeenMs).toISOString() : null,
      ageDays: ageDays === null ? null : Math.round(ageDays * 10) / 10,
      txCount: nonce, tokenTransfers: recentTok.length, counterparties: counterparties.size,
      funder, funderFanout, payersIn: payerCounts.size, repeatPayers, relayedPaymentsOut,
      attributionCodes: [...codes], isContract, flaggedScam, balances, historyComplete: historyOk,
    },
    sources: [...sources],
    checkedAt: new Date().toISOString(),
  };

  if (opts.depth === "report") {
    try {
      result.summary = await summarize(
        `Verdict ${verdict}, score ${score}/100, max ${maxUsd} USD. Signals: ${signals.map((s) => `${s.label}: ${s.detail}`).join(" | ")}`,
      );
      if (result.summary) result.sources.push("cencori (paid via buy)");
    } catch (e) {
      result.summary = null;
      result.sources.push(`cencori failed: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return result;
}

/** The free preview: verdict and score only, no signal detail. */
export function toPreview(r: CheckResult) {
  return {
    target: r.target, subject: r.subject, score: r.score, verdict: r.verdict, maxUsd: r.maxUsd,
    agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
    signals: r.signals.map((s) => ({ key: s.key, label: s.label, status: s.status })),
    checkedAt: r.checkedAt,
    upgrade: "GET /v1/check/{target} ($0.01) returns every signal with its evidence; /v1/report adds a written summary.",
  };
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtDays = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`);
function fmt(v: bigint, decimals: number) {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals, -decimals + 2);
  return `${whole}.${frac}`;
}
