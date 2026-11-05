import { all, one } from "./db.ts";

const DAY = 86_400_000;
// Postgres folds unquoted aliases to lowercase, so camelCase aliases are quoted.
const dayOf = `to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

export async function stats() {
  const now = Date.now();
  const since = now - 14 * DAY;

  const [totals, latencyRows, checkDays, revenueDays, verdictRows, recentChecks, payers, services, timeline] = await Promise.all([
    one(`
      SELECT
        (SELECT COUNT(*) FROM checks WHERE kind IN ('check','report')) AS "paidChecks",
        (SELECT COUNT(*) FROM checks WHERE kind = 'preview') AS "previews",
        (SELECT COALESCE(SUM(usd),0) FROM payments WHERE direction='in') AS "revenue",
        (SELECT COALESCE(SUM(usd),0) FROM payments WHERE direction='out') AS "spend",
        (SELECT COUNT(*) FROM payments WHERE direction='out') AS "serviceCalls",
        (SELECT COUNT(DISTINCT counterparty) FROM payments WHERE direction='in') AS "payers",
        (SELECT COUNT(*) FROM (SELECT counterparty FROM payments WHERE direction='in' GROUP BY counterparty HAVING COUNT(*) > 1) r) AS "repeatPayers",
        (SELECT COUNT(*) FROM checks WHERE created_at > $1) AS "last24h"`, [now - DAY]),
    all(`SELECT ms FROM checks WHERE ms IS NOT NULL ORDER BY id DESC LIMIT 200`),
    all(`SELECT ${dayOf} AS d, kind, COUNT(*) AS n FROM checks WHERE created_at > $1 GROUP BY 1, 2`, [since]),
    all(`SELECT ${dayOf} AS d, SUM(usd) AS usd FROM payments WHERE direction='in' AND created_at > $1 GROUP BY 1`, [since]),
    all(`SELECT verdict, COUNT(*) AS n FROM checks GROUP BY verdict`),
    all(`SELECT id, created_at, kind, target, subject, agent_id, score, verdict, max_usd, payer, ms,
        result->'agent'->>'name' AS agent_name FROM checks ORDER BY id DESC LIMIT 25`),
    all(`SELECT counterparty, COUNT(*) AS calls, SUM(usd) AS usd, MIN(created_at) AS first, MAX(created_at) AS last
        FROM payments WHERE direction='in' GROUP BY counterparty ORDER BY calls DESC LIMIT 20`),
    all(`SELECT counterparty AS service, COUNT(*) AS calls, SUM(usd) AS usd, MAX(created_at) AS last
        FROM payments WHERE direction='out' GROUP BY counterparty ORDER BY calls DESC`),
    all(`SELECT created_at, direction, counterparty, resource, asset, usd, tx FROM payments ORDER BY id DESC LIMIT 15`),
  ]);

  const latency = latencyRows.map((r) => Number(r.ms)).sort((a, b) => a - b);
  const p50 = latency.length ? latency[Math.floor(latency.length / 2)] : null;

  // 14-day series, zero-filled.
  const days: { day: string; checks: number; previews: number; revenue: number }[] = [];
  for (let i = 13; i >= 0; i--) days.push({ day: new Date(now - i * DAY).toISOString().slice(0, 10), checks: 0, previews: 0, revenue: 0 });
  const idx = new Map(days.map((d, i) => [d.day, i]));
  for (const r of checkDays) {
    const i = idx.get(String(r.d)); if (i === undefined) continue;
    if (r.kind === "preview") days[i].previews += Number(r.n); else days[i].checks += Number(r.n);
  }
  for (const r of revenueDays) {
    const i = idx.get(String(r.d)); if (i !== undefined) days[i].revenue = Number(r.usd ?? 0);
  }

  const verdicts: Record<string, number> = { pay: 0, cap: 0, refuse: 0 };
  for (const r of verdictRows) verdicts[String(r.verdict)] = Number(r.n);

  return { totals: { ...totals, p50 }, days, verdicts, recentChecks, payers, services, timeline };
}
