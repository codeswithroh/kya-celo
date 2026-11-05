import { CheckBox, CopyCode, VerdictChip } from "./ui";
import { useJson, type Config } from "./lib";

const SIGNALS = [
  ["ERC-8004 identity", "Is the wallet a registered agent, and who owns it."],
  ["Reputation", "Feedback on the Celo reputation registry, with rater count."],
  ["Wallet age", "First block with a nonce or balance, read from archive state."],
  ["Funding source", "Who funded it first, and how many other wallets that funder seeded."],
  ["Gets paid", "Distinct wallets that paid it in stablecoins, and how many came back."],
  ["Pays by signature", "Signed USD payments a relayer settled: how x402 buyers pay."],
  ["Attribution tags", "ERC-8021 codes on its transactions."],
  ["Explorer flags", "Addresses the explorer marks as scams are refused outright."],
];

const EXAMPLE = `{
  "verdict": "cap",
  "score": 58,
  "maxUsd": 1,
  "reason": "Pay up to $1 per payment, or pay after delivery.",
  "agent": { "id": "10035", "name": "MarketScout AI" },
  "signals": [
    { "label": "ERC-8004 identity", "status": "good", "points": 15,
      "detail": "Registered as agent #10035 (MarketScout AI)." },
    { "label": "Wallet age", "status": "bad", "points": -15,
      "detail": "First seen 2026-11-04 (4h ago)." },
    { "label": "Funding source", "status": "warn", "points": -8,
      "detail": "Funder 0x7c48…8986 seeded 29 wallets recently." }
  ]
}`;

export default function Landing() {
  const { data: cfg } = useJson<Config>("/api/config");
  const base = cfg?.publicUrl ?? "https://kya.example";
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 font-semibold">
          <img src="/icon.svg" className="size-8" alt="" /> KYA
        </a>
        <nav className="flex items-center gap-1 text-sm">
          <a href="#api" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:text-ink sm:block">API</a>
          <a href="#pricing" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:text-ink sm:block">Pricing</a>
          <a href="/app" className="rounded-xl bg-ink px-4 py-2 font-semibold text-white">Open dashboard</a>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-lime-2 px-3 py-1 text-xs font-semibold text-ink">
              Live on Celo · ERC-8004 · x402
            </p>
            <h1 className="text-[clamp(2.4rem,6vw,4.2rem)] font-semibold leading-[1.02] tracking-tight">
              Check an agent before you pay it.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
              Your agent is about to send money to another agent. KYA reads that wallet's identity, age, funding and
              payment history on Celo and answers <b className="text-ink">pay</b>, <b className="text-ink">cap</b> or{" "}
              <b className="text-ink">refuse</b>, with a safe amount. One check costs $0.01 in USA₮.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/app" className="rounded-xl bg-ink px-5 py-3 font-semibold text-white">Open dashboard</a>
              <a href="#api" className="rounded-xl border border-line bg-white px-5 py-3 font-semibold">See the API</a>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-ink-2">
              <div><div className="num text-2xl font-semibold text-ink">$0.01</div>per check</div>
              <div><div className="num text-2xl font-semibold text-ink">~4s</div>median answer</div>
              <div><div className="num text-2xl font-semibold text-ink">8</div>onchain signals</div>
            </div>
          </div>
          <div className="card p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Try it free</h2>
              <span className="text-xs text-ink-3">20 previews a day</span>
            </div>
            <CheckBox />
          </div>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">Three answers, one number</h2>
            <p className="mt-2 max-w-2xl text-ink-2">Every check ends in a verdict your agent can branch on, plus the largest payment it should make to that wallet.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {([
                ["pay", "Score 70+", "Registered, aged, paid by others. Pay up to $25, or $100 above 85."],
                ["cap", "Score 45–69", "Real but thin history. Pay $1–5, or pay after delivery."],
                ["refuse", "Score under 45", "New, unfunded, farm-funded or flagged. Do not prepay."],
              ] as const).map(([v, s, d]) => (
                <div key={v} className="rounded-2xl border border-line p-5">
                  <div className="flex items-center justify-between"><VerdictChip v={v} size="lg" /><span className="num text-sm text-ink-3">{s}</span></div>
                  <p className="mt-4 text-sm leading-relaxed text-ink-2">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">What it reads</h2>
              <p className="mt-2 text-ink-2">All public Celo mainnet data. Every signal comes back with the evidence and the points it moved.</p>
              <ul className="mt-6 divide-y divide-line">
                {SIGNALS.map(([t, d]) => (
                  <li key={t} className="flex gap-4 py-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-lime ring-4 ring-lime-2" />
                    <div><div className="font-medium">{t}</div><div className="text-sm text-ink-2">{d}</div></div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-3 text-sm font-medium text-ink-2">A paid check returns</div>
              <CopyCode code={EXAMPLE} />
            </div>
          </div>
        </section>

        <section id="api" className="bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">Add it in one line</h2>
            <p className="mt-2 max-w-2xl text-ink-2">
              Standard x402. Any x402 client pays it: the buy CLI, <code className="font-mono text-sm">@x402/fetch</code>, or the KYA MCP server.
              No account, no API key. You need USA₮, USDC or USD₮ on Celo, and no CELO for gas.
            </p>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              <div><div className="mb-2 text-sm font-semibold">buy CLI</div><CopyCode code={`npx @celo/buy curl \\\n  ${base}/v1/check/8004:10035`} /></div>
              <div><div className="mb-2 text-sm font-semibold">MCP (Claude Code, Cursor…)</div><CopyCode code={`claude mcp add kya \\\n  -e KYA_URL=${base} \\\n  -e KYA_PAYER_KEY=0x… \\\n  -- npx tsx mcp/server.ts`} /></div>
              <div><div className="mb-2 text-sm font-semibold">TypeScript</div><CopyCode code={`const r = await payFetch(\n  \`${base}/v1/check/\${wallet}\`);\nconst { verdict, maxUsd } = await r.json();\nif (verdict === "refuse") return;`} /></div>
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ["Preview", "Free", "Verdict, score and signal chips. 20 a day per IP.", "/api/preview/{target}"],
              ["Check", "$0.01", "Every signal with evidence and points, safe amount, reason.", "/v1/check/{target}"],
              ["Report", "$0.05", "Check plus finer age sampling over Chainstack and a written summary.", "/v1/report/{target}"],
            ].map(([n, p, d, path], i) => (
              <div key={n} className={`rounded-2xl p-6 ${i === 1 ? "bg-ink text-white" : "card"}`}>
                <div className="text-sm font-medium opacity-70">{n}</div>
                <div className="num mt-1 text-4xl font-semibold">{p}</div>
                <p className="mt-3 text-sm opacity-80">{d}</p>
                <code className={`mt-4 block font-mono text-xs ${i === 1 ? "text-lime" : "text-ink-2"}`}>GET {path}</code>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-3">Paid in USA₮, USDC or USD₮ through Celo's x402 facilitator. If a check fails, you are not charged.</p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-3 sm:px-6">
          <span>KYA · built for Agents on Open Rails, Celo</span>
          <span className="flex gap-4">
            <a href="/agent.json" className="hover:text-ink">ERC-8004 registration</a>
            <a href="/app" className="hover:text-ink">Dashboard</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
