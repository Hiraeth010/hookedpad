// Conviction cap (a ready-made rule on the rules engine), end to end on devnet with real Meteora trades.
//   1. the named rule through the site's own launch path: starts at 0.1%, creator exempt, listing check
//   2. the same rule with a 20-second growth step instead of a day, so the cap can be watched growing
//      on-chain and resetting on a sell
//   WALLET=<devnet keypair.json> npx tsx --env-file=.env.local scripts/e2e-conviction.mts
import fs from "node:fs";
import { Connection, Keypair, SystemProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { nodeById, convictionRules } from "../app/lib/node/nodeTypes.ts";
import { createPoolWithHook, initializeNode, type WalletLike, type LaunchSpec } from "../app/lib/node/launch.ts";
import { buildHookSwap } from "../app/lib/node/swap.ts";
import { verifyLaunch } from "../app/lib/node/chain.ts";
import { refusedRule } from "../app/lib/node/engine/client.ts";

const conn = new Connection(process.env.HELIUS_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(process.env.WALLET!, "utf8"))));
const walletOf = (kp: Keypair): WalletLike => ({ publicKey: kp.publicKey, async sendTransaction(tx: Transaction, c: Connection, o?: { signers?: Keypair[] }) { tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash; tx.feePayer = kp.publicKey; tx.sign(kp, ...(o?.signers ?? [])); return c.sendRawTransaction(tx.serialize(), { maxRetries: 5 }); } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c: unknown, label: string) => { console.log(`  ${c ? "✓" : "✕"} ${label}`); if (!c) fails++; };
async function send(tx: Transaction, signers: Keypair[]) {
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  for (let i = 0; i < 60; i++) { const st = (await conn.getSignatureStatuses([sig])).value[0]; if (st?.err) throw new Error(`tx failed ${JSON.stringify(st.err)}`); if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig; await sleep(700); }
  return sig;
}
async function sim(tx: Transaction, feePayer: PublicKey): Promise<null | number | string> {
  const r = await conn.simulateTransaction(new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: (await conn.getLatestBlockhash()).blockhash, instructions: tx.instructions }).compileToV0Message()), { sigVerify: false, replaceRecentBlockhash: true });
  if (!r.value.err) return null;
  const logs = (r.value.logs ?? []).join("\n");
  return refusedRule(logs) ?? logs.match(/Error Code: (\w+)/)?.[1] ?? JSON.stringify(r.value.err).slice(0, 90);
}
const ata = (mint: PublicKey, w: PublicKey) => getAssociatedTokenAddressSync(mint, w, false, TOKEN_2022_PROGRAM_ID);
const bal = async (mint: PublicKey, w: PublicKey) => { try { return BigInt((await conn.getTokenAccountBalance(ata(mint, w))).value.amount); } catch { return 0n; } };
const pctOf = (raw: bigint) => `${(Number(raw) / 1e16).toFixed(3)}%`; // of a 1B supply with 9 decimals
type Tok = { mint: string; pool: string; config: string };
const buy = (who: PublicKey, T: Tok, lamports: bigint) => buildHookSwap(conn, who, T.mint, T.pool, false, lamports, 0n);

const start = await conn.getBalance(payer.publicKey);
console.log(`wallet ${(start / 1e9).toFixed(3)} devnet SOL`);
const alice = Keypair.generate();
await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: alice.publicKey, lamports: 80_000_000 })), [payer]);
const base = { name: "Conviction Test", description: "", imageFile: null, supply: 1_000_000_000, initialMcap: 2, migrationMcap: 1_000_000, decimals: 9 };
async function launch(nodeId: string, symbol: string, params: Record<string, number | string>) {
  const node = nodeById(nodeId)!;
  const spec = { ...base, symbol, nodeId, params } as LaunchSpec;
  const T = await createPoolWithHook(conn, walletOf(payer), node, spec, "");
  await initializeNode(conn, walletOf(payer), node, new PublicKey(T.mint), { ...spec, params: { ...params, __pool: T.pool } });
  await send(new Transaction().add(...[payer, alice].map((k) => createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(new PublicKey(T.mint), k.publicKey), k.publicKey, new PublicKey(T.mint), TOKEN_2022_PROGRAM_ID))), [payer]);
  return T;
}

// ---- 1. the named rule, as the launcher sets it up ----
const P = { startCap: 0.1, growthUnit: "day", growthPerDay: 0.1, maxCap: 2, histCap: 1000 };
console.log(`rule: ${convictionRules(P)}`);
const A = await launch("conviction", "CONV", P);
{
  const v = await verifyLaunch("conviction", A.mint, A.pool, A.config, P);
  ok(v.ok, `Conviction cap launched through the site's code and passes the listing check${v.ok ? "" : ": " + v.reason}`);
  const lie = await verifyLaunch("conviction", A.mint, A.pool, A.config, { ...P, startCap: 1 });
  ok(!lie.ok, "a listing that claims different settings than the chain has is refused");
  const mint = new PublicKey(A.mint);
  await send(await buy(alice.publicKey, A, 1_000_000n), [alice]);
  ok((await bal(mint, alice.publicKey)) > 0n, `a new wallet buys ${pctOf(await bal(mint, alice.publicKey))} of supply, under its 0.1% starting cap (real trade)`);
  ok((await sim(await buy(alice.publicKey, A, 5_000_000n), alice.publicKey)) === 1, "the same wallet's bigger buy (about 0.25%) is refused by the rule");
  await send(await buy(payer.publicKey, A, 60_000_000n), [payer]);
  ok((await bal(mint, payer.publicKey)) > 20_000_000n * 1_000_000_000n, `the creator's ${pctOf(await bal(mint, payer.publicKey))} launch buy goes through: exempt (real trade)`);
}

// ---- 2. the same rule with a 20-second step, to watch it grow and reset ----
const FAST = convictionRules(P).replace("/ 1d", "/ 20s");
// a 5,000-wallet table, so this copy runs on the hashed table format (over 4,096 wallets)
const B = await launch("custom", "CONF", { rules: FAST, histCap: 5000 });
{
  const mint = new PublicKey(B.mint);
  await send(await buy(alice.publicKey, B, 1_000_000n), [alice]);
  const first = await bal(mint, alice.publicKey);
  ok(first > 0n, `fast copy (cap grows every 20 seconds): alice's first buy of ${pctOf(first)} goes through (real trade)`);
  ok((await sim(await buy(alice.publicKey, B, 3_000_000n), alice.publicKey)) === 1, "straight away, a buy of about 0.15% is over her 0.1% cap: refused");
  console.log("  … holding for 45 seconds (two growth steps: cap 0.3%)");
  await sleep(45_000);
  await send(await buy(alice.publicKey, B, 3_000_000n), [alice]);
  const second = (await bal(mint, alice.publicKey)) - first;
  ok(second > 1_000_000n * 1_000_000_000n, `after holding, the same wallet buys ${pctOf(second)} in one go: her cap grew (real trade)`);
  await send(await buildHookSwap(conn, alice.publicKey, B.mint, B.pool, true, first / 2n, 0n), [alice]);
  ok(true, "alice sells a little (real trade): sells are never capped");
  ok((await sim(await buy(alice.publicKey, B, 3_000_000n), alice.publicKey)) === 1, "right after selling, the 0.15% buy is refused again: selling reset her cap to 0.1%");
  ok((await sim(await buy(alice.publicKey, B, 1_000_000n), alice.publicKey)) === null, "a 0.05% buy still goes through at the starting cap");
}

const left = await conn.getBalance(alice.publicKey);
if (left > 10_000) await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: alice.publicKey, toPubkey: payer.publicKey, lamports: left - 5_000 })), [alice]).catch(() => {});
console.log(`\n${fails ? `${fails} FAILED` : "CONVICTION CAP OK"} · net cost ${((start - (await conn.getBalance(payer.publicKey))) / 1e9).toFixed(4)} SOL · token ${A.mint}`);
process.exit(fails ? 1 : 0);
