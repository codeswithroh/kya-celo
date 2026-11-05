/**
 * Registers KYA in the Celo ERC-8004 Identity Registry from the agent wallet.
 * The transaction carries the hackathon attribution tag. Gas is paid in USDC through the
 * fee-currency adapter when the wallet holds no CELO.
 *
 *   npm run register -- https://your-host/agent.json
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEventLogs, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution, verifyTx } from "@celo/attribution-tags";
import { ATTRIBUTION_CODE, IDENTITY_REGISTRY, PUBLIC_URL } from "../server/config.ts";

const uri = process.argv[2] ?? `${PUBLIC_URL}/agent.json`;
if (uri.includes("localhost")) throw new Error(`Registration URI must be public, got ${uri}. Deploy first, then pass the URL.`);

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(ATTRIBUTION_CODE));

const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
const USDC_FEE_ADAPTER = "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B";
const celoBal = await publicClient.getBalance({ address: account.address });

const { request } = await publicClient.simulateContract({ account, address: IDENTITY_REGISTRY, abi, functionName: "register", args: [uri] });
const hash = await wallet.writeContract({ ...request, ...(celoBal === 0n ? { feeCurrency: USDC_FEE_ADAPTER } : {}) } as never);
console.log("tx", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const [ev] = parseEventLogs({ abi, eventName: "Registered", logs: receipt.logs });
console.log(`Registered as agent ${ev.args.agentId}. Put KYA_AGENT_ID=${ev.args.agentId} in .env and redeploy.`);
const tag = await verifyTx({ client: publicClient, hash });
console.log("attribution codes on tx:", tag?.codes ?? "NONE (check withAttribution)");
