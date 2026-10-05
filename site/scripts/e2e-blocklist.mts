// Blocklist (programs/blocklist), end to end on devnet through the site's own launch code with real
// Meteora trades: named wallets can never receive the token.
//   launch with 61 blocked wallets (three chunks + seal) → passes the listing check, list sealed
//   bob (blocked) can't buy, and nobody can send him the token; alice buys and sends freely
//   a buy built by Meteora's stock SDK (what aggregators build on) works for alice
//   after sealing nothing can be added; a pool's wallet can never be listed; strangers can't set it up
//   WALLET=<devnet keypair.json> npx tsx --env-file=.env.local scripts/e2e-blocklist.mts
import fs from "node:fs";
import { Connection, Keypair, SystemProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { nodeById } from "../app/lib/node/nodeTypes.ts";
import { createPoolWithHook, initializeNode, type WalletLike, type LaunchSpec } from "../app/lib/node/launch.ts";
import { buildHookSwap } from "../app/lib/node/swap.ts";
import { verifyLaunch } from "../app/lib/node/chain.ts";
import { blocklistPda, decodeBlocklist, addBlockedIx, initializeBlocklistIx } from "../app/lib/node/blocklist.ts";

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
async function simError(tx: Transaction, feePayer: PublicKey): Promise<string | null> {
  const { blockhash } = await conn.getLatestBlockhash();
  const sim = await conn.simulateTransaction(new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx.instructions }).compileToV0Message()), { sigVerify: false, replaceRecentBlockhash: true });
  if (!sim.value.err) return null;
  return (sim.value.logs ?? []).find((l) => l.includes("Error Code:"))?.replace(/.*Error Code: (\w+).*/, "$1") ?? JSON.stringify(sim.value.err).slice(0, 80);
}
const ata = (mint: PublicKey, w: PublicKey) => getAssociatedTokenAddressSync(mint, w, false, TOKEN_2022_PROGRAM_ID);
const bal = async (mint: PublicKey, w: PublicKey) => { try { return BigInt((await conn.getTokenAccountBalance(ata(mint, w))).value.amount); } catch { return 0n; } };

const start = await conn.getBalance(payer.publicKey);
console.log(`wallet ${(start / 1e9).toFixed(3)} devnet SOL`);
const [alice, bob, carol] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
await send(new Transaction().add(...[alice, bob].map((k) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 60_000_000 }))), [payer]);
const others = Array.from({ length: 60 }, () => Keypair.generate().publicKey.toBase58());
const node = nodeById("blocklist")!;
const spec: LaunchSpec = { name: "Blocklist Test", symbol: "BLKT", description: "", imageFile: null, supply: 1_000_000_000, nodeId: "blocklist", params: { blocklist: [...others.slice(0, 30), bob.publicKey.toBase58(), ...others.slice(30)].join("\n") }, initialMcap: 2, migrationMcap: 1_000_000, decimals: 9 };
const T = await createPoolWithHook(conn, walletOf(payer), node, spec, "");
const mint = new PublicKey(T.mint), pool = new PublicKey(T.pool);
ok((await simError(new Transaction().add(initializeBlocklistIx({ payer: alice.publicKey, mint, pool, capacity: 5 })), alice.publicKey)) === "NotCreator", "a stranger can't set it up (NotCreator)");
await initializeNode(conn, walletOf(payer), node, mint, { ...spec, params: { ...spec.params, __pool: T.pool } });
{
  const l = decodeBlocklist((await conn.getAccountInfo(blocklistPda(mint), "confirmed"))!.data)!;
  const v = await verifyLaunch("blocklist", T.mint, T.pool, T.config);
  ok(l.wallets.length === 61 && l.sealed && l.wallets.some((w) => w.equals(bob.publicKey)), `launched through the site's code: ${l.wallets.length} wallets written in chunks, sealed`);
  ok(v.ok, `passes the listing check${v.ok ? "" : ": " + v.reason}`);
}
await send(new Transaction().add(...[alice, bob, carol].map((k) => createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(mint, k.publicKey), k.publicKey, mint, TOKEN_2022_PROGRAM_ID))), [payer]);
ok((await simError(await buildHookSwap(conn, bob.publicKey, T.mint, T.pool, false, 5_000_000n, 0n), bob.publicKey)) === "Blocked", "bob (blocked) can't buy (Blocked)");
await send(await buildHookSwap(conn, alice.publicKey, T.mint, T.pool, false, 5_000_000n, 0n), [alice]);
const got = await bal(mint, alice.publicKey);
ok(got > 0n, "alice (not blocked) buys (real trade)");
const sendTo = async (to: PublicKey) => new Transaction().add(await createTransferCheckedWithTransferHookInstruction(conn, ata(mint, alice.publicKey), mint, ata(mint, to), alice.publicKey, got / 10n, 9, [], "confirmed", TOKEN_2022_PROGRAM_ID));
ok((await simError(await sendTo(bob.publicKey), alice.publicKey)) === "Blocked", "alice can't send it to bob either (Blocked)");
await send(await sendTo(carol.publicKey), [alice]);
ok((await bal(mint, carol.publicKey)) === got / 10n, "alice sends to carol freely (real transfer)");
{
  const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const BN = (await import("bn.js")).default;
  const before = await bal(mint, alice.publicKey);
  const tx = await new DynamicBondingCurveClient(conn, "confirmed").pool.swap2WithTransferHook({ owner: alice.publicKey, payer: alice.publicKey, pool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: 0, amountIn: new BN(2_000_000), minimumAmountOut: new BN(0) } as never);
  await send(tx as Transaction, [alice]);
  ok((await bal(mint, alice.publicKey)) > before, "a buy built by Meteora's stock SDK (what aggregators build on) goes through (real trade)");
}
ok((await simError(new Transaction().add(addBlockedIx(payer.publicKey, mint, [alice.publicKey])), payer.publicKey)) === "Sealed", "after sealing, nothing can be added (Sealed)");
{
  // a fresh, unsealed list: a pool's wallet can't be listed
  const T2 = await createPoolWithHook(conn, walletOf(payer), node, { ...spec, symbol: "BLK2" }, "");
  const m2 = new PublicKey(T2.mint);
  await send(new Transaction().add(initializeBlocklistIx({ payer: payer.publicKey, mint: m2, pool: new PublicKey(T2.pool), capacity: 3 })), [payer]);
  ok((await simError(new Transaction().add(addBlockedIx(payer.publicKey, m2, [new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM")])), payer.publicKey)) === "PoolWallet", "Meteora's pool wallet can never be listed (PoolWallet)");
}

for (const k of [alice, bob]) { const left = await conn.getBalance(k.publicKey); if (left > 10_000) await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: payer.publicKey, lamports: left - 5_000 })), [k]).catch(() => {}); }
console.log(`\n${fails ? `${fails} FAILED` : "BLOCKLIST OK"} · net cost ${((start - (await conn.getBalance(payer.publicKey))) / 1e9).toFixed(4)} SOL · token ${T.mint}`);
process.exit(fails ? 1 : 0);
