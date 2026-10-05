// The rules engine (programs/rules), end to end on devnet with real Meteora trades: rule source is
// compiled here, put on-chain, and the hook runs it on every transfer.
//   token 1 uses every kind of signal at once (transfer, wallet history, the transaction, the pool,
//   counters, named wallets, a time zone) and still trades through Meteora's stock SDK;
//   token 2 checks the market-cap signal against a real price move.
//   WALLET=<devnet keypair.json> npx tsx --env-file=.env.local scripts/e2e-rules.mts
import fs from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { nodeById, type NodeType } from "../app/lib/node/nodeTypes.ts";
import { createPoolWithHook, type WalletLike, type LaunchSpec } from "../app/lib/node/launch.ts";
import { buildHookSwap } from "../app/lib/node/swap.ts";
import { compileRules, decompileRules, type Compiled } from "../app/lib/node/engine/lang.ts";
import { RULES_PROGRAM, rulesPda, setupRulesTxs, decodeRules, refusedRule } from "../app/lib/node/engine/client.ts";

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
/** null = would succeed; a number = the rule that refused it; a string = some other error */
async function sim(tx: Transaction, feePayer: PublicKey): Promise<null | number | string> {
  const { blockhash } = await conn.getLatestBlockhash();
  const r = await conn.simulateTransaction(new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx.instructions }).compileToV0Message()), { sigVerify: false, replaceRecentBlockhash: true });
  if (!r.value.err) return null;
  const logs = (r.value.logs ?? []).join("\n");
  return refusedRule(logs) ?? logs.match(/Error Code: (\w+)/)?.[1] ?? JSON.stringify(r.value.err).slice(0, 90);
}
const ata = (mint: PublicKey, w: PublicKey) => getAssociatedTokenAddressSync(mint, w, false, TOKEN_2022_PROGRAM_ID);
const bal = async (mint: PublicKey, w: PublicKey) => { try { return BigInt((await conn.getTokenAccountBalance(ata(mint, w))).value.amount); } catch { return 0n; } };
const buy = (who: PublicKey, T: { mint: string; pool: string }, lamports: bigint) => buildHookSwap(conn, who, T.mint, T.pool, false, lamports, 0n);
const sell = (who: PublicKey, T: { mint: string; pool: string }, raw: bigint) => buildHookSwap(conn, who, T.mint, T.pool, true, raw, 0n);

const start = await conn.getBalance(payer.publicKey);
console.log(`wallet ${(start / 1e9).toFixed(3)} devnet SOL`);
const [alice, bob, carol] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
await send(new Transaction().add(...[alice, bob, carol].map((k, i) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: i === 0 ? 400_000_000 : 40_000_000 }))), [payer]);
const node = { ...nodeById("blocklist")!, id: "rules", program: RULES_PROGRAM.toBase58() } as NodeType;
const spec = (symbol: string): LaunchSpec => ({ name: "Rules Test", symbol, description: "", imageFile: null, supply: 1_000_000_000, nodeId: "rules", params: {}, initialMcap: 2, migrationMcap: 1_000_000, decimals: 9 });
async function launch(symbol: string, src: string, before?: (mint: PublicKey, pool: PublicKey, config: PublicKey, c: Compiled) => Promise<void>) {
  const c = compileRules(src, { decimals: 9, histCap: 600 });
  if (!c.ok) throw new Error(JSON.stringify(c.errors));
  const T = await createPoolWithHook(conn, walletOf(payer), node, spec(symbol), "");
  const mint = new PublicKey(T.mint), pool = new PublicKey(T.pool), config = new PublicKey(T.config);
  if (before) await before(mint, pool, config, c);
  const txs = setupRulesTxs({ payer: payer.publicKey, mint, pool, poolConfig: config, compiled: c });
  for (const tx of txs) await send(tx, [payer]);
  await send(new Transaction().add(...[payer, alice, bob, carol].map((k) => createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(mint, k.publicKey), k.publicKey, mint, TOKEN_2022_PROGRAM_ID))), [payer]);
  return { T, mint, pool, c, txs: txs.length };
}

// ---- token 1: every kind of signal ----
const SRC1 = `# every kind of signal in one rule set
timezone America/New_York
refuse if is_buy and amount > 1% and not trader is creator
refuse if is_sell and sender_seconds_since_buy < 40s
refuse if is_buy and priority_fee > 0.001 SOL
refuse if is_buy and market_cap > 100000 SOL
require is_sell or not receiver is ${bob.publicKey.toBase58()}
refuse if is_buy and buys_this_slot >= 5
require hour >= 0 and weekday <= sun`;
const A = await launch("RULA", SRC1, async (mint, pool, config, c) => {
  const stranger = setupRulesTxs({ payer: alice.publicKey, mint, pool, poolConfig: config, compiled: c });
  ok((await sim(stranger[0], alice.publicKey)) === "NotCreator", "a stranger can't set a token's rules (NotCreator)");
  const garbage = { ...c, code: Uint8Array.from([0x02, 0x02, 0x60]) }; // leaves a value on the stack
  ok((await sim(setupRulesTxs({ payer: payer.publicKey, mint, pool, poolConfig: config, compiled: garbage })[0], payer.publicKey)) === "BadRules", "bytecode that doesn't check out is refused on-chain (BadRules)");
});
{
  const acct = decodeRules((await conn.getAccountInfo(rulesPda(A.mint), "confirmed"))!.data)!;
  const back = decompileRules(acct.code, acct.keys, acct.tz, acct.decimals);
  ok(acct.live && acct.nRules === 7 && acct.flags === 15 && Buffer.from(acct.code).equals(Buffer.from(A.c.code)), `7 rules live on-chain in ${A.txs} transaction(s): ${A.c.bytes} bytes of bytecode, every extra account in use (a 600-wallet history table grown past 10 KB)`);
  ok(back?.rules.length === 7 && back.source.includes("sender_seconds_since_buy < 40s"), `the on-chain bytecode decompiles back to the rules ("${back?.rules[1].explain}")`);
  const late = setupRulesTxs({ payer: payer.publicKey, mint: A.mint, pool: A.pool, poolConfig: new PublicKey(A.T.config), compiled: A.c });
  ok((await sim(new Transaction().add(late[0].instructions[1]), payer.publicKey)) === "Live", "once live, the rules can't be rewritten (Live)");

  await send(await buy(alice.publicKey, A.T, 5_000_000n), [alice]);
  const got = await bal(A.mint, alice.publicKey);
  ok(got > 0n, "alice's small buy goes through (real trade)");
  ok((await sim(await buy(alice.publicKey, A.T, 100_000_000n), alice.publicKey)) === 1, "rule 1: alice's buy of over 1% of supply is refused");
  await send(await buy(payer.publicKey, A.T, 100_000_000n), [payer]);
  ok((await bal(A.mint, payer.publicKey)) > 10_000_000n * 1_000_000_000n, "rule 1: the creator's buy of over 1% goes through (real trade)");
  ok((await sim(await sell(alice.publicKey, A.T, got / 2n), alice.publicKey)) === 2, "rule 2 (wallet history): alice can't sell within 40 seconds of buying");
  ok((await sim(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000_000 }), ...(await buy(alice.publicKey, A.T, 5_000_000n)).instructions), alice.publicKey)) === 3, "rule 3 (the transaction): a buy paying a 0.002 SOL priority fee is refused");
  ok((await sim(await buy(bob.publicKey, A.T, 5_000_000n), bob.publicKey)) === 5, "rule 5 (named wallet): bob can't buy");
  // a send carries the buy time with it
  await send(new Transaction().add(await createTransferCheckedWithTransferHookInstruction(conn, ata(A.mint, alice.publicKey), A.mint, ata(A.mint, carol.publicKey), alice.publicKey, got / 4n, 9, [], "confirmed", TOKEN_2022_PROGRAM_ID)), [alice]);
  ok((await bal(A.mint, carol.publicKey)) === got / 4n, "alice sends some to carol (real transfer)");
  ok((await sim(await sell(carol.publicKey, A.T, got / 8n), carol.publicKey)) === 2, "rule 2: the cooldown follows the tokens, so carol can't sell them either");
  {
    const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
    const BN = (await import("bn.js")).default;
    const before = await bal(A.mint, alice.publicKey);
    const tx = await new DynamicBondingCurveClient(conn, "confirmed").pool.swap2WithTransferHook({ owner: alice.publicKey, payer: alice.publicKey, pool: A.pool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: 0, amountIn: new BN(2_000_000), minimumAmountOut: new BN(0) } as never);
    await send(tx as Transaction, [alice]);
    ok((await bal(A.mint, alice.publicKey)) > before, "a buy built by Meteora's stock SDK goes through with all four extra accounts (real trade): any DEX can trade it");
  }
  console.log("  … waiting out the 40-second cooldown");
  await sleep(45_000);
  await send(await sell(carol.publicKey, A.T, got / 8n), [carol]);
  ok((await bal(A.mint, carol.publicKey)) === got / 4n - got / 8n, "40 seconds later carol sells (real trade)");
  const after = decodeRules((await conn.getAccountInfo(rulesPda(A.mint), "confirmed"))!.data)!;
  ok(after.totalBuys === 3 && after.totalSells === 1 && after.holders === 3 && after.lastBuyer.equals(alice.publicKey), `the token's counters kept count: ${after.totalBuys} buys, ${after.totalSells} sell, ${after.holders} holders, latest buyer alice`);
}

// ---- token 2: market cap from the pool ----
const B2 = await launch("RULB", "refuse if is_buy and market_cap > 2.2 SOL and not trader is creator\nrefuse if is_sell and curve_progress > 50%");
{
  await send(await buy(alice.publicKey, B2.T, 3_000_000n), [alice]);
  ok((await bal(B2.mint, alice.publicKey)) > 0n, "token 2 launched at a 2 SOL market cap: alice buys under the 2.2 SOL line (real trade)");
  await send(await buy(payer.publicKey, B2.T, 150_000_000n), [payer]);
  ok((await sim(await buy(alice.publicKey, B2.T, 3_000_000n), alice.publicKey)) === 1, "after the creator's buy pushes the market cap past 2.2 SOL, alice's buy is refused by rule 1 (the pool signal)");
  await send(await sell(alice.publicKey, B2.T, (await bal(B2.mint, alice.publicKey)) / 2n), [alice]);
  ok(true, "alice sells: the curve is nowhere near 50% full (real trade)");
}

for (const k of [alice, bob, carol]) { const left = await conn.getBalance(k.publicKey); if (left > 10_000) await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: payer.publicKey, lamports: left - 5_000 })), [k]).catch(() => {}); }
console.log(`\n${fails ? `${fails} FAILED` : "RULES ENGINE OK"} · net cost ${((start - (await conn.getBalance(payer.publicKey))) / 1e9).toFixed(4)} SOL · token 1 ${A.T.mint}`);
process.exit(fails ? 1 : 0);
