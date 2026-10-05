// Custom hook through the site's own launch path on devnet: launch with a rule set (as the AI hook
// builder produces it), list it, and check the listing refuses rule text that doesn't match the chain.
//   WALLET=<devnet keypair.json> npx tsx --env-file=.env.local scripts/e2e-custom.mts
import fs from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { nodeById } from "../app/lib/node/nodeTypes.ts";
import { createPoolWithHook, initializeNode, type WalletLike, type LaunchSpec } from "../app/lib/node/launch.ts";
import { buildHookSwap } from "../app/lib/node/swap.ts";
import { verifyLaunch } from "../app/lib/node/chain.ts";
import { refusedRule } from "../app/lib/node/engine/client.ts";

const conn = new Connection(process.env.HELIUS_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(process.env.WALLET!, "utf8"))));
const wallet: WalletLike = { publicKey: payer.publicKey, async sendTransaction(tx: Transaction, c: Connection, o?: { signers?: Keypair[] }) { tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash; tx.feePayer = payer.publicKey; tx.sign(payer, ...(o?.signers ?? [])); return c.sendRawTransaction(tx.serialize(), { maxRetries: 5 }); } };
let fails = 0;
const ok = (c: unknown, label: string) => { console.log(`  ${c ? "✓" : "✕"} ${label}`); if (!c) fails++; };
const RULES = `timezone Europe/London
refuse if is_buy and amount > 0.5% and not trader is creator                      # max 0.5% of supply per buy
refuse if not is_sell and receiver_balance > 2% and not receiver is creator       # max 2% per wallet
refuse if is_buy and buys_this_slot >= 3                                          # at most 3 buys per slot (anti-bundle)
refuse if is_sell and sender_seconds_since_buy < 10m                              # wait 10 minutes after buying before selling`;
const node = nodeById("custom")!;
const spec: LaunchSpec = { name: "Custom Hook Test", symbol: "CUST", description: "", imageFile: null, supply: 1_000_000_000, nodeId: "custom", params: { rules: RULES }, initialMcap: 2, migrationMcap: 1_000_000, decimals: 9 };
const T = await createPoolWithHook(conn, wallet, node, spec, "");
await initializeNode(conn, wallet, node, new PublicKey(T.mint), { ...spec, params: { ...spec.params, __pool: T.pool } });
const v = await verifyLaunch("custom", T.mint, T.pool, T.config, { rules: RULES });
ok(v.ok, `launched through the site's code and passes the listing check${v.ok ? "" : ": " + v.reason}`);
const lie = await verifyLaunch("custom", T.mint, T.pool, T.config, { rules: RULES.replace("0.5%", "5%") });
ok(!lie.ok && /don't match/.test(lie.reason ?? ""), `rule text that doesn't match the chain is refused a listing (${lie.reason})`);
const stranger = Keypair.generate().publicKey;
const tx = await buildHookSwap(conn, payer.publicKey, T.mint, T.pool, false, 50_000_000n, 0n);
const sim = async (t: Transaction, who: PublicKey) => { const r = await conn.simulateTransaction(new VersionedTransaction(new TransactionMessage({ payerKey: who, recentBlockhash: (await conn.getLatestBlockhash()).blockhash, instructions: t.instructions }).compileToV0Message()), { sigVerify: false, replaceRecentBlockhash: true }); return r.value.err ? refusedRule((r.value.logs ?? []).join("\n")) ?? "other error" : null; };
ok((await sim(tx, payer.publicKey)) === null, "the creator's launch buy of over 0.5% is allowed (exempt by the rule)");
void stranger;
console.log(`\n${fails ? `${fails} FAILED` : "CUSTOM HOOK OK"} · token ${T.mint}`);
process.exit(fails ? 1 : 0);
