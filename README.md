# KYA: Know Your Agent

Your agent is about to pay another agent on Celo. KYA tells it whether to: **pay**, **cap** or **refuse**, the largest safe payment, and the onchain evidence behind the answer. One check costs $0.01 in USA₮, USDC or USD₮ over x402.

Built for the Agents on Open Rails hackathon (Celo). Tracks: **Open Corridors: USA₮ with x402** and **Build with buy**.

## Who pays for it, and why

Agents on Celo now pay each other through x402 with no human approving each payment. Before an agent sends money, it has to decide whether the wallet on the other side is a real service or a fresh wallet seeded by a farm. ERC-8004 gives every agent an identity, but the registry does not check anything: anyone can register, and anyone can leave feedback.

KYA does that check. The customer is the operator of a paying agent: a buy-gateway user, a hackathon team whose agent buys services, or a marketplace listing agents. They call `/v1/check/{wallet}` before a payment and branch on `verdict` and `maxUsd`.

**Why USA₮:** the answer protects US-dollar payments, so we price and settle in a US-regulated dollar. Any verified human can get USA₮ from the Google Cloud faucet with Self, and x402 makes it gasless, so a new agent can pay for its first check without ever touching CELO.

## What a check reads

| Signal | Source | Effect |
|---|---|---|
| ERC-8004 identity | Identity Registry, 8004scan | +12 to +15 if registered, −5 if not |
| Reputation | Reputation Registry `getClients`, 8004scan | +10 / −15 by average, rater count shown |
| Wallet age | Archive state sampling (nonce + balances at 16–32 blocks, then refined) | −15 under a day, +12 over 6 months |
| Funding source | First inbound transfer, then the funder's fan-out | −8 if the funder seeded 25+ wallets |
| Gets paid | Distinct stablecoin payers, repeat payers | up to +12 |
| Pays by signature | Stablecoin transfers out that a relayer settled (x402 / EIP-3009 / Permit2) | +4 |
| Attribution | ERC-8021 suffix on its transactions | +3 |
| Explorer scam flag | Blockscout | −60, always refuse |

Score starts at 50. **70+ → pay** (up to $25, or $100 above 85). **45–69 → cap** ($1–5, or pay after delivery). **Under 45 → refuse.** Missing explorer data is reported and skipped, never counted against the wallet.

## API

| Route | Price | Returns |
|---|---|---|
| `GET /api/preview/{target}` | free, 20/day/IP | verdict, score, signal chips |
| `GET /v1/check/{target}` | $0.01 | every signal with evidence and points, `maxUsd`, `reason` |
| `GET /v1/report/{target}` | $0.05 | check + finer age sampling over Chainstack + written summary from Cencori |
| `GET /agent.json` | free | KYA's ERC-8004 registration file |

`target` is a `0x` address or an ERC-8004 id (`8004:123`). A failed check returns 4xx and the x402 middleware does not settle, so a failed check costs nothing.

```bash
npx @celo/buy curl https://<host>/v1/check/8004:10035
```

MCP (tools `kya_preview`, `kya_check`, `kya_report`):

```bash
claude mcp add kya -e KYA_URL=https://<host> -e KYA_PAYER_KEY=0x... -- npx tsx mcp/server.ts
```

## What KYA buys (Build with buy)

Every `/v1/report` pays for two services KYA does not own, through the buy gateway from the tagged agent wallet:

- **Chainstack Celo RPC** (`/chainstack/celo`, $0.01 per batch): archive reads for wallet age and balances, 32×32 sampling in one or two batches.
- **Cencori inference** (`/cencori/v1/chat/completions`, $0.01): the 2–3 sentence written summary.

Each outgoing payment is logged with its settlement tx and shown on the dashboard under *Services KYA pays for*. Free SQD/Blockscout data is used where it is enough.

## Architecture

```
agent ──x402──▶ KYA (Hono) ──▶ engine ──▶ 8004scan, Blockscout, Forno
                 │  @x402/hono → api.x402.celo.org (settles USA₮/USDC/USD₮)
                 │  onAfterSettle → Postgres (payments in)
                 └─ reports ──x402──▶ buy gateway → Chainstack, Cencori (payments out)
web: landing (/) + dashboard (/app), React + Vite, served by the same process
```

- `server/engine.ts`: signals, score, verdict
- `server/index.ts`: routes, x402 paywall, settlement log
- `server/buy.ts`: paid calls through the buy gateway
- `mcp/server.ts`: MCP server for other agents
- `scripts/`: wallet, ERC-8004 registration, buyer test

## Hackathon requirements

- **Celo mainnet:** set `X402_NETWORK=mainnet`. Data is always read from mainnet.
- **Attribution tag:** every transaction the agent wallet sends goes through `withAttribution(ATTRIBUTION_CODE)` (`scripts/register-8004.ts`). x402 settlements cannot carry tags; the PayTo address is the agent wallet, listed below.
- **ERC-8004:** `npm run register -- https://<host>/agent.json` from the agent wallet.
- **One wallet** for the whole event: the agent wallet receives payments, owns the identity and pays for buy services.

| | |
|---|---|
| Agent wallet / PayTo | `0x9E8A2aE522f5768d721fb5Ad6E840D408612e5e3` |
| ERC-8004 agent id | set after registration |
| Attribution code | `celo_9a5077c029be` |

## Run it

Needs Node 20+. Storage is Postgres: set `DATABASE_URL` (Supabase), or leave it unset to use an embedded Postgres (PGlite) in `data/pglite`.

```bash
npm install
cp .env.example .env
npm run wallet          # creates the agent wallet in .env, prints balances
npm run build && npm start   # http://localhost:8787 (landing) and /app (dashboard)
```

Development with hot reload: `npm run dev` (API on 8787, web on 5173).

Go live:

1. Create a facilitator key at x402.celo.org (sign in with GitHub for mainnet credits). Put it in `X402_API_KEY`, set `X402_NETWORK=mainnet`.
2. Fund the agent wallet with a few USDC or USA₮ on Celo (no CELO needed).
3. Create a free Supabase project and copy the **Transaction pooler** connection string (port 6543) into `DATABASE_URL`.
4. Deploy on Render: New → Blueprint → this repo (`render.yaml`). Fill in `DATABASE_URL`, `AGENT_PRIVATE_KEY`, `X402_API_KEY` and `PUBLIC_URL`. Set the GitHub Actions variable `KYA_URL` so `keepalive.yml` stops the free instance from sleeping.
5. `npm run register -- $PUBLIC_URL/agent.json`, then put the id in `KYA_AGENT_ID`.
6. `BUY_ENABLED=1` to buy Chainstack and Cencori per report.
7. Test a real payment from a different wallet: `BUYER_PRIVATE_KEY=0x... npm run pay-check -- 8004:10035 $PUBLIC_URL`.

## Limits

- Wallet age from free RPC is precise to about 4 days (16×16 samples); reports sample 32×32 through Chainstack.
- Blockscout's free API rate-limits; set `BLOCKSCOUT_API_KEY` for steady counterparty and payment signals.
- Reputation averages come from 8004scan; the registry does not vet raters, so KYA reports the rater count next to the score.
