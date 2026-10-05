// Trading hours (programs/schedule), end to end on devnet through the site's own launch code with
// real Meteora trades: the token trades only during the days and hours its creator set, in any zone.
//   A: a zone where it's daytime now, open only today until 3 minutes from now → a buy passes (also
//      one built by Meteora's stock SDK), then once the window shuts a buy is refused, live
//   B: India (UTC+5:30), closed today, sells closed → buys and sells refused; the creator can still
//      buy; wallet-to-wallet sends always work
//   C: as B but sells stay open → the sell goes through, the buy is still refused
//   strangers can't set it up, and a timetable with no days is refused
//   WALLET=<devnet keypair.json> npx tsx --env-file=.env.local scripts/e2e-schedule.mts
import fs from "node:fs";
import { Connection, Keypair, SystemProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { nodeById } from "../app/lib/node/nodeTypes.ts";
import { createPoolWithHook, initializeNode, type WalletLike, type LaunchSpec } from "../app/lib/node/launch.ts";
import { buildHookSwap } from "../app/lib/node/swap.ts";
import { verifyLaunch } from "../app/lib/node/chain.ts";
import { schedulePda, decodeScheduleCfg, initializeScheduleIx, scheduleFromParams, openAt, zoneOffsetMin, formatHours, type DayHours } from "../app/lib/node/schedule.ts";

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
/** the chain's clock, as the hook sees it (Clock sysvar unix_timestamp @32) */
const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"))!.data.readBigInt64LE(32));
/** local weekday and minute of `ts` in `tz` */
const localOf = (tz: string, ts: number) => { const l = ts + zoneOffsetMin(tz, ts) * 60; return { wd: (Math.floor(l / 86400) + 4) % 7, m: Math.floor((((l % 86400) + 86400) % 86400) / 60) }; };
const hoursOnly = (on: (d: number) => boolean, open: number, close: number) => formatHours(Array.from({ length: 7 }, (_, d): DayHours => ({ on: on(d), open, close })));

const start = await conn.getBalance(payer.publicKey);
console.log(`wallet ${(start / 1e9).toFixed(3)} devnet SOL`);
const alice = Keypair.generate();
await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: alice.publicKey, lamports: 80_000_000 })), [payer]);
const node = nodeById("schedule")!;
const base: Omit<LaunchSpec, "params" | "symbol"> = { name: "Hours Test", description: "", imageFile: null, supply: 1_000_000_000, nodeId: "schedule", initialMcap: 2, migrationMcap: 1_000_000, decimals: 9 };
async function launch(symbol: string, params: Record<string, string>, checks?: (mint: PublicKey, pool: PublicKey) => Promise<void>) {
  const spec = { ...base, symbol, params } as LaunchSpec;
  const T = await createPoolWithHook(conn, walletOf(payer), node, spec, "");
  const mint = new PublicKey(T.mint), pool = new PublicKey(T.pool);
  if (checks) await checks(mint, pool);
  await initializeNode(conn, walletOf(payer), node, mint, { ...spec, params: { ...spec.params, __pool: T.pool } });
  await send(new Transaction().add(...[payer, alice].map((k) => createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(mint, k.publicKey), k.publicKey, mint, TOKEN_2022_PROGRAM_ID))), [payer]);
  return { T, mint, pool };
}

// ---- A: open today until 3 minutes from now, in a zone where it's daytime ----
let now = await chainNow();
const tzA = ["America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Auckland", "America/Los_Angeles"].find((z) => { const { m } = localOf(z, now); return m > 60 && m < 1380; })!;
const la = localOf(tzA, now + 90); // launching takes about a minute
const closeA = la.m + 4;
const A = await launch("HRSA", { tz: tzA, hours: hoursOnly((d) => d === la.wd, la.m - 60, closeA), afterHours: "closed" }, async (mint, pool) => {
  ok((await simError(new Transaction().add(initializeScheduleIx({ payer: alice.publicKey, mint, pool, sellsOpen: false, ...scheduleFromParams({ tz: tzA }) })), alice.publicKey)) === "NotCreator", "a stranger can't set it up (NotCreator)");
  const bad = scheduleFromParams({ tz: tzA, hours: "" }); // no trading days at all
  ok((await simError(new Transaction().add(initializeScheduleIx({ payer: payer.publicKey, mint, pool, sellsOpen: false, ...bad })), payer.publicKey)) === "BadSchedule", "a timetable with no trading days is refused (BadSchedule)");
});
{
  const c = decodeScheduleCfg((await conn.getAccountInfo(schedulePda(A.mint), "confirmed"))!.data)!;
  const v = await verifyLaunch("schedule", A.T.mint, A.T.pool, A.T.config);
  ok(c.tz === tzA && c.schedule.days === 1 << la.wd && c.schedule.windows[la.wd][1] === closeA && v.ok, `launched through the site's code: ${tzA}, ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][la.wd]} only, closes ${String(Math.floor(closeA / 60)).padStart(2, "0")}:${String(closeA % 60).padStart(2, "0")} local; listing check ${v.ok ? "passes" : "fails: " + v.reason}`);
  now = await chainNow();
  ok(openAt(c.schedule, now), `the site's copy of the clock says open now (chain time ${new Date(now * 1000).toISOString()})`);
  await send(await buildHookSwap(conn, alice.publicKey, A.T.mint, A.T.pool, false, 5_000_000n, 0n), [alice]);
  ok((await bal(A.mint, alice.publicKey)) > 0n, "inside the hours: alice buys (real trade)");
  const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const BN = (await import("bn.js")).default;
  const before = await bal(A.mint, alice.publicKey);
  const tx = await new DynamicBondingCurveClient(conn, "confirmed").pool.swap2WithTransferHook({ owner: alice.publicKey, payer: alice.publicKey, pool: A.pool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: 0, amountIn: new BN(2_000_000), minimumAmountOut: new BN(0) } as never);
  await send(tx as Transaction, [alice]);
  ok((await bal(A.mint, alice.publicKey)) > before, "a buy built by Meteora's stock SDK (what aggregators build on) goes through (real trade)");
  // wait for the window to shut on the chain's clock
  while (openAt(c.schedule, (now = await chainNow()))) await sleep(5_000);
  ok((await simError(await buildHookSwap(conn, alice.publicKey, A.T.mint, A.T.pool, false, 5_000_000n, 0n), alice.publicKey)) === "Closed", `after the window shut (chain time ${new Date(now * 1000).toISOString()}): alice's buy is refused (Closed)`);
  ok((await simError(await buildHookSwap(conn, alice.publicKey, A.T.mint, A.T.pool, true, (await bal(A.mint, alice.publicKey)) / 2n, 0n), alice.publicKey)) === "Closed", "…and so is her sell (Closed)");
}

// ---- B and C: India (UTC+5:30), closed today ----
const today = localOf("Asia/Kolkata", await chainNow()).wd;
for (const sellsOpen of [false, true]) {
  const X = await launch(sellsOpen ? "HRSC" : "HRSB", { tz: "Asia/Kolkata", hours: hoursOnly((d) => d !== today, 555, 930), afterHours: sellsOpen ? "sells" : "closed" });
  const tag = sellsOpen ? "C (sells stay open)" : "B (sells closed)";
  ok((await simError(await buildHookSwap(conn, alice.publicKey, X.T.mint, X.T.pool, false, 5_000_000n, 0n), alice.publicKey)) === "Closed", `${tag}: closed today in India, alice's buy is refused (Closed)`);
  await send(await buildHookSwap(conn, payer.publicKey, X.T.mint, X.T.pool, false, 20_000_000n, 0n), [payer]);
  const got = await bal(X.mint, payer.publicKey);
  ok(got > 0n, `${tag}: the creator can still buy (real trade)`);
  await send(new Transaction().add(await createTransferCheckedWithTransferHookInstruction(conn, ata(X.mint, payer.publicKey), X.mint, ata(X.mint, alice.publicKey), payer.publicKey, got / 2n, 9, [], "confirmed", TOKEN_2022_PROGRAM_ID)), [payer]);
  ok((await bal(X.mint, alice.publicKey)) === got / 2n, `${tag}: wallet-to-wallet sends always work (real transfer)`);
  const sell = await buildHookSwap(conn, alice.publicKey, X.T.mint, X.T.pool, true, got / 4n, 0n);
  if (!sellsOpen) ok((await simError(sell, alice.publicKey)) === "Closed", `${tag}: alice's sell is refused (Closed)`);
  else { await send(sell, [alice]); ok((await bal(X.mint, alice.publicKey)) === got / 2n - got / 4n, `${tag}: alice sells while closed (real trade)`); }
}

const left = await conn.getBalance(alice.publicKey);
if (left > 10_000) await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: alice.publicKey, toPubkey: payer.publicKey, lamports: left - 5_000 })), [alice]).catch(() => {});
console.log(`\n${fails ? `${fails} FAILED` : "TRADING HOURS OK"} · net cost ${((start - (await conn.getBalance(payer.publicKey))) / 1e9).toFixed(4)} SOL · token A ${A.T.mint}`);
process.exit(fails ? 1 : 0);
