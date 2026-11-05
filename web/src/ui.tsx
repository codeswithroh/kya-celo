import { useState, type ReactNode } from "react";
import { STATUS, VERDICT, type Preview, type Verdict } from "./lib";

export function VerdictChip({ v, size = "sm" }: { v: Verdict; size?: "sm" | "lg" }) {
  const s = VERDICT[v];
  return (
    <span className={`${s.bg} ${s.fg} inline-flex items-center gap-1.5 rounded-full font-semibold ${size === "lg" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs"}`}>
      <span className="size-1.5 rounded-full" style={{ background: s.hex }} />
      {s.label}
    </span>
  );
}

export function ScoreRing({ score, verdict, size = 112 }: { score: number; verdict: Verdict; size?: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#e9eee8" strokeWidth="9" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={VERDICT[verdict].hex} strokeWidth="9" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-3xl font-semibold leading-none">{score}</div>
          <div className="mt-1 text-[11px] text-ink-3">of 100</div>
        </div>
      </div>
    </div>
  );
}

export function SignalChips({ signals }: { signals: Preview["signals"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {signals.map((s) => (
        <span key={s.key + s.label} className={`${STATUS[s.status]} rounded-lg px-2 py-1 text-xs font-medium`}>{s.label}</span>
      ))}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid min-h-28 place-items-center rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">{children}</div>;
}

export function CopyCode({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-2xl bg-ink p-4 pr-16 font-mono text-[12.5px] leading-relaxed text-lime-2">{code}</pre>
      <button
        onClick={() => { navigator.clipboard?.writeText(code); setDone(true); setTimeout(() => setDone(false), 1200); }}
        className="absolute right-3 top-3 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/20"
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Free preview form + result, used on the landing page and the dashboard. */
export function CheckBox({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (t = target) => {
    if (!t.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch(`/api/preview/${encodeURIComponent(t.trim())}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setRes(j); onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="0x… wallet or 8004:123"
          className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3.5 py-2.5 font-mono text-sm outline-none focus:border-ink"
          aria-label="Wallet address or ERC-8004 agent id"
        />
        <button disabled={busy} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Checking…" : "Check"}
        </button>
      </form>
      {!res && !busy && !err && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-ink-3">
          Try
          {["8004:10035", "8004:9895"].map((t) => (
            <button key={t} onClick={() => { setTarget(t); run(t); }} className="rounded-md bg-canvas px-1.5 font-mono text-ink-2 hover:text-ink">{t}</button>
          ))}
        </div>
      )}
      {busy && (
        <div className="mt-4 flex animate-pulse items-center gap-4">
          <div className="size-24 rounded-full bg-canvas" />
          <div className="flex-1 space-y-2"><div className="h-4 w-24 rounded bg-canvas" /><div className="h-3 w-40 rounded bg-canvas" /><div className="h-3 w-32 rounded bg-canvas" /></div>
        </div>
      )}
      {err && <p className="mt-3 rounded-xl bg-refuse-bg px-3 py-2 text-sm text-refuse">{err}</p>}
      {res && (
        <div className={`mt-4 flex ${compact ? "flex-col" : "flex-col sm:flex-row"} gap-4`}>
          <ScoreRing score={res.score} verdict={res.verdict} size={compact ? 96 : 112} />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictChip v={res.verdict} size="lg" />
              <span className="num text-sm text-ink-2">{res.maxUsd > 0 ? `max $${res.maxUsd} per payment` : "do not prepay"}</span>
            </div>
            <div className="truncate text-sm text-ink-2">
              {res.agent ? <b className="font-semibold text-ink">{res.agent.name ?? `Agent #${res.agent.id}`}</b> : "No ERC-8004 identity"}
              <span className="font-mono text-xs text-ink-3"> · {res.subject?.slice(0, 10)}…</span>
            </div>
            <SignalChips signals={res.signals} />
            <p className="text-xs text-ink-3">Free preview. The paid check returns the evidence behind each chip.</p>
          </div>
        </div>
      )}
    </div>
  );
}
