/**
 * Creates the KYA agent wallet in .env if there is none, then prints its address and balances.
 * The private key never leaves .env.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { celo } from "viem/chains";
import { TOKENS } from "../server/config.ts";

let key = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  const base = existsSync(".env") ? readFileSync(".env", "utf8") : readFileSync(".env.example", "utf8");
  const next = /^AGENT_PRIVATE_KEY=.*$/m.test(base) ? base.replace(/^AGENT_PRIVATE_KEY=.*$/m, `AGENT_PRIVATE_KEY=${key}`) : `${base}\nAGENT_PRIVATE_KEY=${key}\n`;
  writeFileSync(".env", next, { mode: 0o600 });
  console.log("Created a new agent wallet and saved its key to .env");
}
const account = privateKeyToAccount(key);
console.log("Agent wallet:", account.address);

const client = createPublicClient({ chain: celo, transport: http() });
const celoBal = await client.getBalance({ address: account.address });
console.log(`  CELO ${formatUnits(celoBal, 18)}`);
for (const t of TOKENS.filter((t) => t.usd)) {
  const b = await client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  console.log(`  ${t.symbol} ${formatUnits(b, t.decimals)}`);
}
