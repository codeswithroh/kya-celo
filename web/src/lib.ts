import { useEffect, useState } from "react";

export type Verdict = "pay" | "cap" | "refuse";
export type SignalStatus = "good" | "warn" | "bad" | "info";

export type Preview = {
  target: string;
  subject: string | null;
  score: number;
  verdict: Verdict;
  maxUsd: number;
  agent: { id: string; name: string | null } | null;
  signals: { key: string; label: string; status: SignalStatus }[];
  checkedAt: string;
  paid?: boolean;
};

export type Config = {
  network: "testnet" | "mainnet";
  caip2: string;
  facilitator: string;
  paywall: boolean;
  payTo: string | null;
  agentWallet: string | null;
  agentId: string | null;
  attributionCode: string;
  buyEnabled: boolean;
  prices: { check: number; report: number };
  assets: string[];
  publicUrl: string;
};

type Row = Record<string, string | number | null>;
export type Stats = {
  totals: {
    paidChecks: number; previews: number; revenue: number; spend: number; serviceCalls: number;
    payers: number; repeatPayers: number; last24h: number; p50: number | null;
  };
  days: { day: string; checks: number; previews: number; revenue: number }[];
  verdicts: Record<Verdict, number>;
  recentChecks: Row[];
  payers: Row[];
  services: Row[];
  timeline: Row[];
};

export function useJson<T>(url: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((j) => alive && (setData(j), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    const t = refreshMs ? setTimeout(() => setTick((x) => x + 1), refreshMs) : undefined;
    return () => { alive = false; clearTimeout(t); };
  }, [url, refreshMs, tick]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const usd = (n: number | null | undefined, d = 2) => `$${(n ?? 0).toFixed(d)}`;
export const ago = (ms: number) => {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
export const explorerTx = (net: string, tx: string) =>
  net === "mainnet" ? `https://celoscan.io/tx/${tx}` : `https://celo-sepolia.blockscout.com/tx/${tx}`;
export const explorerAddr = (a: string) => `https://celoscan.io/address/${a}`;

export const VERDICT: Record<Verdict, { label: string; fg: string; bg: string; hex: string }> = {
  pay: { label: "Pay", fg: "text-pay", bg: "bg-pay-bg", hex: "#15803d" },
  cap: { label: "Cap", fg: "text-cap", bg: "bg-cap-bg", hex: "#d97706" },
  refuse: { label: "Refuse", fg: "text-refuse", bg: "bg-refuse-bg", hex: "#b91c1c" },
};
export const STATUS: Record<SignalStatus, string> = {
  good: "bg-pay-bg text-pay",
  warn: "bg-cap-bg text-cap",
  bad: "bg-refuse-bg text-refuse",
  info: "bg-info-bg text-info",
};
