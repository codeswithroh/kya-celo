import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import { DATABASE_URL, PGLITE_DIR } from "./config.ts";

type Row = Record<string, unknown>;

/**
 * One Postgres dialect everywhere: a real Postgres (Supabase) when DATABASE_URL is set,
 * otherwise PGlite, an embedded Postgres stored in data/pglite, for local runs.
 * int8 and numeric come back as JS numbers.
 */
interface Db {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  exec(sql: string): Promise<void>;
}

function connect(): Db {
  if (DATABASE_URL) {
    const sql = postgres(DATABASE_URL, {
      max: Number(process.env.PG_POOL_MAX ?? 5),
      prepare: false, // Supabase's transaction pooler does not support prepared statements
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : "require",
      types: { num: { to: 20, from: [20, 1700], serialize: String, parse: Number } },
      onnotice: () => {},
    });
    return {
      query: async (q, p = []) => (await sql.unsafe(q, p as never[])) as unknown as Row[],
      exec: async (q) => void (await sql.unsafe(q)),
    };
  }
  mkdirSync(PGLITE_DIR, { recursive: true });
  const pg = new PGlite(PGLITE_DIR, { parsers: { 20: Number, 1700: Number } });
  return {
    query: async (q, p = []) => (await pg.query<Row>(q, p)).rows,
    exec: async (q) => void (await pg.exec(q)),
  };
}

const db = connect();
export const dbKind = DATABASE_URL ? "postgres" : "pglite";

const ready = db.exec(`
CREATE TABLE IF NOT EXISTS checks (
  id BIGSERIAL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  kind TEXT NOT NULL,             -- preview | check | report
  target TEXT NOT NULL,           -- what the caller asked about
  subject TEXT,                   -- resolved wallet address
  agent_id TEXT,
  score INTEGER NOT NULL,
  verdict TEXT NOT NULL,          -- pay | cap | refuse
  max_usd DOUBLE PRECISION,
  payer TEXT,                     -- wallet that paid for this check (null for previews)
  ms INTEGER,
  result JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS checks_created ON checks(created_at);
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  direction TEXT NOT NULL,        -- in (someone paid KYA) | out (KYA paid a service)
  counterparty TEXT NOT NULL,     -- payer for "in", service for "out"
  resource TEXT,
  asset TEXT,
  amount TEXT,                    -- atomic units
  usd DOUBLE PRECISION,
  tx TEXT,
  network TEXT
);
CREATE INDEX IF NOT EXISTS payments_created ON payments(created_at);
CREATE TABLE IF NOT EXISTS previews (ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, day));
`);

export async function all(sql: string, params: unknown[] = []): Promise<Row[]> {
  await ready;
  return db.query(sql, params);
}
export async function one(sql: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await all(sql, params))[0];
}

export async function insertCheck(row: {
  kind: string; target: string; subject?: string | null; agentId?: string | null; score: number;
  verdict: string; maxUsd?: number | null; payer?: string | null; ms?: number; result: unknown;
}): Promise<number> {
  const r = await one(
    `INSERT INTO checks (created_at, kind, target, subject, agent_id, score, verdict, max_usd, payer, ms, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text::jsonb) RETURNING id`,
    [Date.now(), row.kind, row.target, row.subject ?? null, row.agentId ?? null, row.score, row.verdict,
      row.maxUsd ?? null, row.payer?.toLowerCase() ?? null, row.ms ?? null, JSON.stringify(row.result)],
  );
  return Number(r?.id);
}

export async function insertPayment(row: {
  direction: "in" | "out"; counterparty: string; resource?: string; asset?: string; amount?: string;
  usd?: number; tx?: string; network?: string;
}) {
  await all(
    `INSERT INTO payments (created_at, direction, counterparty, resource, asset, amount, usd, tx, network)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [Date.now(), row.direction, row.counterparty.toLowerCase(), row.resource ?? null, row.asset ?? null,
      row.amount ?? null, row.usd ?? null, row.tx ?? null, row.network ?? null],
  );
}

/** Returns true when this IP still has free previews left today (one atomic upsert). */
export async function takePreview(ip: string, limit: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const r = await one(
    `INSERT INTO previews (ip, day, n) VALUES ($1, $2, 1)
     ON CONFLICT (ip, day) DO UPDATE SET n = previews.n + 1 WHERE previews.n < $3
     RETURNING n`,
    [ip, day, limit],
  );
  return !!r;
}

/** Stored result of one check, for the dashboard drawer. */
export async function getCheck(id: number) {
  return one(`SELECT kind, result FROM checks WHERE id = $1`, [id]) as Promise<{ kind: string; result: unknown } | undefined>;
}
