import "dotenv/config";
import { getAddress, type Address, type Hex } from "viem";

const env = process.env;

export const ATTRIBUTION_CODE = env.ATTRIBUTION_CODE ?? "celo_9a5077c029be";

/** "mainnet" settles real money on Celo (42220). "testnet" uses Celo Sepolia USDC. */
export const X402_NETWORK: "mainnet" | "testnet" = env.X402_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const X402_API_KEY = env.X402_API_KEY ?? "";
export const FACILITATOR_URL =
  X402_NETWORK === "mainnet" ? "https://api.x402.celo.org" : "https://api.x402.sepolia.celo.org";
export const CAIP2 = X402_NETWORK === "mainnet" ? "eip155:42220" : "eip155:11142220";

export const AGENT_PRIVATE_KEY = (env.AGENT_PRIVATE_KEY ?? "") as Hex;
export const PAY_TO = env.PAY_TO ? getAddress(env.PAY_TO) : undefined;

/** Our own ERC-8004 agent id, filled in after `npm run register`. */
export const KYA_AGENT_ID = env.KYA_AGENT_ID ? BigInt(env.KYA_AGENT_ID) : undefined;

/** When set, full reports buy Chainstack RPC + Cencori inference through the buy gateway. */
export const BUY_ENABLED = env.BUY_ENABLED === "1" && AGENT_PRIVATE_KEY.length === 66;

export const PORT = Number(env.PORT ?? 8787);
export const PUBLIC_URL = (env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
/** Postgres connection string (Supabase). Unset: embedded PGlite in PGLITE_DIR. */
export const DATABASE_URL = env.DATABASE_URL || null;
export const PGLITE_DIR = env.PGLITE_DIR ?? "data/pglite";

/** Prices in 6-decimal USD stablecoin units. */
export const PRICE_CHECK = env.PRICE_CHECK ?? "10000"; // $0.01
export const PRICE_REPORT = env.PRICE_REPORT ?? "50000"; // $0.05

export const FREE_PREVIEWS_PER_DAY = Number(env.FREE_PREVIEWS_PER_DAY ?? 20);

// ---- Celo mainnet constants (data is always read from mainnet: that is where agents live) ----
export const FORNO = "https://forno.celo.org";
export const BLOCKSCOUT = "https://celo.blockscout.com";
export const SCAN_8004 = "https://api.8004scan.io/api/v1";
export const IDENTITY_REGISTRY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const REPUTATION_REGISTRY: Address = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
export const BUY_GATEWAY = "https://gateway.usebuy.ai";

export type Token = { symbol: string; address: Address; decimals: number; usd: boolean };
export const TOKENS: Token[] = [
  { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, usd: true },
  { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, usd: true },
  { symbol: "USAT", address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", decimals: 6, usd: true },
  { symbol: "wARS", address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D", decimals: 18, usd: false },
  { symbol: "wBRL", address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0", decimals: 18, usd: false },
  { symbol: "wMXN", address: "0x337E7456B420bD3481e7FA61fA9850343d610d34", decimals: 18, usd: false },
  { symbol: "wCOP", address: "0x8a1D45e102e886510e891d2Ec656a708991e2D76", decimals: 18, usd: false },
  { symbol: "cNGN", address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", decimals: 6, usd: false },
];

/** Assets the paid routes accept. Testnet only has USDC. */
export const ACCEPTED_ASSETS =
  X402_NETWORK === "mainnet"
    ? [
        { symbol: "USAT", address: getAddress("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771"), name: "Tether America USD", version: "1" },
        { symbol: "USDC", address: getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"), name: "USDC", version: "2" },
        { symbol: "USDT", address: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"), name: "Tether USD", version: "1" },
      ]
    : [{ symbol: "USDC", address: getAddress("0x01C5C0122039549AD1493B8220cABEdD739BC44E"), name: "USDC", version: "2" }];
