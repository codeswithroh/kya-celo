/**
 * Pays for one KYA check the way a customer agent would (x402 buyer flow).
 *   BUYER_PRIVATE_KEY=0x... npm run pay-check -- 8004:10035 [http://localhost:8787]
 * Use a wallet that is NOT the KYA agent wallet.
 */
import "dotenv/config";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const target = process.argv[2] ?? "8004:10035";
const base = (process.argv[3] ?? process.env.PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, "");
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$0.10" });
client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: process.env.X402_NETWORK === "mainnet" ? "https://forno.celo.org" : "https://forno.celo-sepolia.celo-testnet.org" }));
const payFetch = wrapFetchWithPayment(fetch, client);

const res = await payFetch(`${base}/v1/check/${encodeURIComponent(target)}`);
const receipt = res.headers.get("payment-response");
console.log(res.status, receipt ? JSON.parse(Buffer.from(receipt, "base64").toString()) : "(no payment receipt)");
console.log(JSON.stringify(await res.json(), null, 2));
