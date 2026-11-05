import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CheckBox, CopyCode, Empty, ScoreRing, SignalChips, VerdictChip } from "./ui";
import { ago, explorerAddr, explorerTx, short, usd, useJson, VERDICT, type Config, type Preview, type Stats, type Verdict } from "./lib";

const NAV = [
  ["overview", "Overview"],
  ["checks", "Checks"],
  ["payers", "Payers"],
  ["services", "Services"],
  ["integrate", "Integrate"],
  ["identity", "Identity"],
] as const;

export default function Dashboard() {
  const { data: cfg } = useJson<Config>("/api/config");
  const { data: s, error, reload } = useJson<Stats>("/api/stats", 10_000);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState("overview");

  useEffect(() => {
    const els = NAV.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-30% 0px -60% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [s === null]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      {/* Sidebar */}
      <aside className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur lg:h-screen lg:border-b-0 lg:border-r lg:bg-white">
        <div className="flex items-center gap-2.5 px-4 py-4 lg:px-5 lg:py-6">
          <a href="/" className="flex items-center gap-2.5 font-semibold"><img src="/icon.svg" className="size-8" alt="" /> KYA</a>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium ${active === id ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas hover:text-ink"}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="hidden px-5 lg:absolute lg:bottom-6 lg:block">
          <div className="rounded-2xl bg-lime-2 p-4 text-xs">
            <div className="font-semibold">Attribution tag</div>
            <div className="mt-1 font-mono">{cfg?.attributionCode ?? "…"}</div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-5 sm:px-6 lg:pt-7">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-ink-3">Checks sold, who pays, what KYA buys. Refreshes every 10s.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <Pill ok={cfg?.network === "mainnet"} label={cfg ? (cfg.network === "mainnet" ? "Celo mainnet" : "Celo Sepolia") : "…"} />
            <Pill ok={!!cfg?.paywall} label={cfg?.paywall ? "x402 paywall on" : "Paywall off"} />
            <Pill ok={!!cfg?.agentId} label={cfg?.agentId ? `Agent #${cfg.agentId}` : "Not registered"} />
            <Pill ok={!!cfg?.buyEnabled} label={cfg?.buyEnabled ? "buy on" : "buy off"} />
          </div>
        </header>

        {error && <div className="mx-4 mt-3 rounded-xl bg-refuse-bg px-4 py-3 text-sm text-refuse sm:mx-6">Could not load stats ({error}). Is the API running?</div>}

        <main className="grid gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-5">
            {/* Stat cards */}
            <section id="overview" className="grid scroll-mt-24 grid-cols-2 gap-3 md:grid-cols-4">
              <Stat dark label="Paid checks" value={s ? String(s.totals.paidChecks) : null} sub={s ? `${s.totals.previews} free previews` : ""} />
              <Stat accent label="Revenue" value={s ? usd(s.totals.revenue) : null} sub={cfg ? cfg.assets.join(" · ") : ""} />
              <Stat label="Paying wallets" value={s ? String(s.totals.payers) : null} sub={s ? `${s.totals.repeatPayers} came back` : ""} />
              <Stat label="Median answer" value={s?.totals.p50 ? `${(s.totals.p50 / 1000).toFixed(1)}s` : s ? "—" : null} sub={s ? `${s.totals.last24h} checks in 24h` : ""} />
            </section>

            <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
              <Card title="Checks per day" action={<Legend items={[["Paid", "#0f2a1f"], ["Preview", "#c6f36b"]]} />}>
                <div className="h-56">
                  {s ? (
                    <ResponsiveContainer>
                      <AreaChart data={s.days} margin={{ left: -24, right: 4, top: 4 }}>
                        <CartesianGrid vertical={false} stroke="#eef1ed" />
                        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8)} tick={{ fontSize: 11, fill: "#8a9a92" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8a9a92" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e3e8e2", fontSize: 12 }} />
                        <Area isAnimationActive={false} type="monotone" dataKey="previews" name="Preview" stackId="1" stroke="#a3d94a" fill="#c6f36b" fillOpacity={0.6} />
                        <Area isAnimationActive={false} type="monotone" dataKey="checks" name="Paid" stackId="1" stroke="#0f2a1f" fill="#0f2a1f" fillOpacity={0.85} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <Skeleton />}
                </div>
              </Card>
              <Card title="Verdicts">
                {s ? <VerdictDonut v={s.verdicts} /> : <Skeleton />}
              </Card>
            </div>

            <Card title="Recent checks" action={<span className="text-xs text-ink-3">Tap a row for detail</span>}>
              <div id="checks" className="scroll-mt-24" />
              {!s ? <Skeleton /> : s.recentChecks.length === 0 ? (
                <Empty>No checks yet. Run one from the panel on the right, or call <code className="font-mono">/v1/check/&lt;wallet&gt;</code>.</Empty>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead><tr className="text-left text-xs text-ink-3">
                      <th className="px-5 pb-2 font-medium">Agent</th><th className="pb-2 font-medium">Verdict</th><th className="pb-2 font-medium">Score</th>
                      <th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium">Paid by</th><th className="px-5 pb-2 text-right font-medium">When</th>
                    </tr></thead>
                    <tbody>
                      {s.recentChecks.map((r) => (
                        <tr key={String(r.id)} onClick={() => setOpen(Number(r.id))} className="cursor-pointer border-t border-line hover:bg-canvas">
                          <td className="px-5 py-2.5">
                            <div className="font-medium">{r.agent_name ? String(r.agent_name) : r.agent_id ? `Agent #${r.agent_id}` : "Unregistered"}</div>
                            <div className="font-mono text-xs text-ink-3">{short(String(r.subject ?? r.target))}</div>
                          </td>
                          <td><VerdictChip v={r.verdict as Verdict} /></td>
                          <td><ScoreBar score={Number(r.score)} verdict={r.verdict as Verdict} /></td>
                          <td><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${r.kind === "preview" ? "bg-canvas text-ink-2" : "bg-lime-2 text-ink"}`}>{String(r.kind)}</span></td>
                          <td className="font-mono text-xs text-ink-2">{r.payer ? short(String(r.payer)) : "—"}</td>
                          <td className="num px-5 text-right text-xs text-ink-3">{ago(Number(r.created_at))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Paying wallets">
                <div id="payers" className="scroll-mt-24" />
                {!s ? <Skeleton /> : s.payers.length === 0 ? <Empty>No paid checks yet. Payers show up here with call counts.</Empty> : (
                  <ul className="space-y-2">
                    {s.payers.map((p) => {
                      const max = Math.max(...s.payers.map((x) => Number(x.calls)));
                      return (
                        <li key={String(p.counterparty)} className="text-sm">
                          <div className="flex items-center justify-between">
                            <a href={explorerAddr(String(p.counterparty))} target="_blank" className="font-mono text-xs hover:underline">{short(String(p.counterparty))}</a>
                            <span className="num text-xs text-ink-2">{String(p.calls)} calls · {usd(Number(p.usd))}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-canvas"><div className="h-full rounded-full bg-ink" style={{ width: `${(Number(p.calls) / max) * 100}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              <Card title="Services KYA pays for">
                <div id="services" className="scroll-mt-24" />
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <Mini label="Spent via buy" value={s ? usd(s.totals.spend) : "…"} />
                  <Mini label="Paid calls" value={s ? String(s.totals.serviceCalls) : "…"} />
                </div>
                {!s ? <Skeleton /> : s.services.length === 0 ? (
                  <Empty>{cfg?.buyEnabled ? "No reports sold yet. Each report buys one Chainstack batch and one Cencori summary." : "buy is off. Set BUY_ENABLED=1 to buy Chainstack RPC and Cencori inference per report."}</Empty>
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {s.services.map((x) => (
                      <li key={String(x.service)} className="flex items-center justify-between py-2">
                        <span className="font-medium">{String(x.service)}</span>
                        <span className="num text-xs text-ink-2">{String(x.calls)} calls · {usd(Number(x.usd))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card title="Integrate">
              <div id="integrate" className="scroll-mt-24" />
              <Integrate cfg={cfg} />
            </Card>

            <Card title="KYA's own identity">
              <div id="identity" className="scroll-mt-24" />
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Field k="ERC-8004 agent" v={cfg?.agentId ? `#${cfg.agentId}` : "Not registered yet: npm run register"} />
                <Field k="Agent wallet" v={cfg?.agentWallet ?? "—"} mono link={cfg?.agentWallet ? explorerAddr(cfg.agentWallet) : undefined} />
                <Field k="Receives payments at" v={cfg?.payTo ?? "—"} mono />
                <Field k="Attribution code" v={cfg?.attributionCode ?? "—"} mono />
                <Field k="Facilitator" v={cfg?.facilitator ?? "—"} mono />
                <Field k="Registration file" v="/agent.json" mono link="/agent.json" />
              </dl>
            </Card>
          </div>

          {/* Right rail */}
          <div className="order-first space-y-5 xl:order-none xl:sticky xl:top-5 xl:self-start">
            <Card title="Check an agent" className="ring-2 ring-lime">
              <CheckBox compact onDone={reload} />
            </Card>
            <Card title="Money in and out">
              {!s ? <Skeleton /> : s.timeline.length === 0 ? <Empty>Settled payments appear here with their transaction.</Empty> : (
                <ol className="relative space-y-4 border-l border-line pl-4">
                  {s.timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span className={`absolute -left-[21px] top-1 size-2.5 rounded-full ring-4 ring-white ${t.direction === "in" ? "bg-pay" : "bg-cap"}`} />
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{t.direction === "in" ? `+${usd(Number(t.usd), 3)}` : `−${usd(Number(t.usd), 3)}`}</span>
                        <span className="text-xs text-ink-3">{ago(Number(t.created_at))}</span>
                      </div>
                      <div className="truncate text-xs text-ink-2">
                        {t.direction === "in" ? `from ${short(String(t.counterparty))}` : `to ${t.counterparty}`}
                        {t.tx && cfg && <> · <a className="underline" target="_blank" href={explorerTx(cfg.network, String(t.tx))}>tx</a></>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </main>
      </div>

      {open !== null && <Drawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${ok ? "bg-pay-bg text-pay" : "bg-white text-ink-2 ring-1 ring-line"}`}>
      <span className={`size-1.5 rounded-full ${ok ? "bg-pay" : "bg-ink-3"}`} />{label}
    </span>
  );
}

function Stat({ label, value, sub, dark, accent }: { label: string; value: string | null; sub: string; dark?: boolean; accent?: boolean }) {
  const cls = dark ? "bg-ink text-white" : accent ? "bg-lime text-ink" : "card";
  return (
    <div className={`rounded-[20px] p-4 sm:p-5 ${cls}`}>
      <div className={`text-xs font-medium ${dark ? "text-white/60" : "text-ink-2"}`}>{label}</div>
      {value === null ? <div className="mt-2 h-8 w-16 animate-pulse rounded bg-black/10" /> : <div className="num mt-1 text-3xl font-semibold tracking-tight">{value}</div>}
      <div className={`mt-1 truncate text-xs ${dark ? "text-white/60" : "text-ink-3"}`}>{sub}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-canvas p-3"><div className="text-xs text-ink-3">{label}</div><div className="num text-xl font-semibold">{value}</div></div>;
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="flex gap-3 text-xs text-ink-2">{items.map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{l}</span>)}</div>;
}

function VerdictDonut({ v }: { v: Record<Verdict, number> }) {
  const data = (["pay", "cap", "refuse"] as Verdict[]).map((k) => ({ k, n: v[k] ?? 0 }));
  const total = data.reduce((a, b) => a + b.n, 0);
  if (!total) return <Empty>Verdict split appears after the first check.</Empty>;
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-36 shrink-0">
        <PieChart width={144} height={144}>
          <Pie data={data.filter((d) => d.n > 0)} dataKey="n" cx={72} cy={72} innerRadius={46} outerRadius={66} paddingAngle={2} stroke="none" isAnimationActive={false}>
            {data.filter((d) => d.n > 0).map((d) => <Cell key={d.k} fill={VERDICT[d.k].hex} />)}
          </Pie>
        </PieChart>
        <div className="absolute inset-0 grid place-items-center"><div className="text-center"><div className="num text-2xl font-semibold">{total}</div><div className="text-[11px] text-ink-3">checks</div></div></div>
      </div>
      <ul className="space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.k} className="flex items-center gap-2">
            <VerdictChip v={d.k} /><span className="num whitespace-nowrap text-ink-2">{d.n} · {Math.round((d.n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreBar({ score, verdict }: { score: number; verdict: Verdict }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-canvas"><div className="h-full rounded-full" style={{ width: `${score}%`, background: VERDICT[verdict].hex }} /></div>
      <span className="num text-xs text-ink-2">{score}</span>
    </div>
  );
}

function Field({ k, v, mono, link }: { k: string; v: string; mono?: boolean; link?: string }) {
  const body = <span className={`${mono ? "font-mono text-xs" : ""} break-all`}>{v}</span>;
  return (
    <div className="rounded-2xl bg-canvas p-3">
      <dt className="text-xs text-ink-3">{k}</dt>
      <dd className="mt-0.5">{link ? <a href={link} target="_blank" className="underline decoration-line underline-offset-2">{body}</a> : body}</dd>
    </div>
  );
}

function Integrate({ cfg }: { cfg: Config | null }) {
  const base = cfg?.publicUrl ?? "";
  const tabs = {
    "buy CLI": `npx @celo/buy curl ${base}/v1/check/8004:10035`,
    MCP: `claude mcp add kya \\\n  -e KYA_URL=${base} \\\n  -e KYA_PAYER_KEY=0x… \\\n  -- npx tsx mcp/server.ts`,
    TypeScript: `import { x402Client, wrapFetchWithPayment } from "@x402/fetch";\nimport { ExactEvmScheme } from "@x402/evm/exact/client";\n\nconst client = new x402Client();\nclient.register("eip155:*", new ExactEvmScheme(account));\nconst payFetch = wrapFetchWithPayment(fetch, client);\n\nconst r = await payFetch(\`${base}/v1/check/\${wallet}\`);\nconst { verdict, maxUsd } = await r.json();\nif (verdict === "refuse" || amount > maxUsd) throw new Error("KYA: do not pay");`,
    "Free preview": `curl ${base}/api/preview/8004:10035`,
  };
  const [tab, setTab] = useState<keyof typeof tabs>("buy CLI");
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(tabs) as (keyof typeof tabs)[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-ink text-white" : "bg-canvas text-ink-2"}`}>{t}</button>
        ))}
      </div>
      <CopyCode code={tabs[tab]} />
      <div className="mt-3 grid gap-2 text-xs text-ink-2 sm:grid-cols-3">
        <div className="rounded-xl bg-canvas p-3"><b className="text-ink">Check</b> · {cfg ? usd(cfg.prices.check) : "…"} · GET /v1/check/&#123;target&#125;</div>
        <div className="rounded-xl bg-canvas p-3"><b className="text-ink">Report</b> · {cfg ? usd(cfg.prices.report) : "…"} · GET /v1/report/&#123;target&#125;</div>
        <div className="rounded-xl bg-canvas p-3"><b className="text-ink">Pays in</b> · {cfg?.assets.join(", ") ?? "…"}</div>
      </div>
    </div>
  );
}

function Drawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error } = useJson<Preview>(`/api/checks/${id}`);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-semibold">Check #{id}</h3>
          <button onClick={onClose} className="rounded-lg bg-canvas px-3 py-1 text-sm">Close</button>
        </div>
        {error && <p className="text-sm text-refuse">{error}</p>}
        {!data ? <Skeleton /> : (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <ScoreRing score={data.score} verdict={data.verdict} />
              <div className="space-y-2">
                <VerdictChip v={data.verdict} size="lg" />
                <div className="num text-sm text-ink-2">{data.maxUsd > 0 ? `Max $${data.maxUsd} per payment` : "Do not prepay"}</div>
              </div>
            </div>
            <Field k="Agent" v={data.agent ? `${data.agent.name ?? "Unnamed"} (#${data.agent.id})` : "No ERC-8004 identity"} />
            <Field k="Wallet" v={data.subject ?? "—"} mono link={data.subject ? explorerAddr(data.subject) : undefined} />
            <div><div className="mb-2 text-xs text-ink-3">Signals</div><SignalChips signals={data.signals} /></div>
            {data.paid && <p className="rounded-xl bg-lime-2 p-3 text-xs">This was a paid check. The full evidence went to the payer only.</p>}
            <div className="text-xs text-ink-3">Checked {new Date(data.checkedAt).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="h-full min-h-24 animate-pulse rounded-2xl bg-canvas" />;
}
