// Editable hook and DAO hook on devnet, end to end through the site's launch code with real Meteora
// trades: a token whose rules its creator rewrites after launch, and one whose rules only a keeper
// wallet can change, with a notice period.
//   WALLET=<devnet keypair.json> npx tsx --env-file=.env.local scripts/e2e-editable.mts
import fs from "node:fs";
import { Connection, Keypair, SystemProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const keeper = Keypair.generate();
process.env.NEXT_PUBLIC_DAO_KEEPER = keeper.publicKey.toBase58(); // read when env.ts loads
const { nodeById } = await import("../app/lib/node/nodeTypes.ts");
const { createPoolWithHook, initializeNode } = await import("../app/lib/node/launch.ts");
type WalletLike = import("../app/lib/node/launch.ts").WalletLike;
type LaunchSpec = import("../app/lib/node/launch.ts").LaunchSpec;
const { buildHookSwap } = await import("../app/lib/node/swap.ts");
const { verifyLaunch } = await import("../app/lib/node/chain.ts");
const { rulesPda, nextPda, decodeRules, decodeNext, refusedRule, changeRulesTxs, applyRulesIx, cancelRulesIx, setupRulesTxs } = await import("../app/lib/node/engine/client.ts");
const { compileRules, decompileRules } = await import("../app/lib/node/engine/lang.ts");

const conn = new Connection(process.env.HELIUS_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(process.env.WALLET!, "utf8"))));
const walletOf = (kp: Keypair): WalletLike => ({ publicKey: kp.publicKey, async sendTransaction(tx: Transaction, c: Connection, o?: { signers?: Keypair[] }) { tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash; tx.feePayer = kp.publicKey; tx.sign(kp, ...(o?.signers ?? [])); return c.sendRawTransaction(tx.serialize(), { maxRetries: 5 }); } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c: unknown, label: string) => { console.log(`  ${c ? "✓" : "✕"} ${label}`); if (!c) fails++; };
async function send(tx: Transaction, signers: Keypair[]) {
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  for (let i = 0; i < 60; i++) { const st = (await conn.getSignatureStatuses([sig])).value[0]; if (st?.err) { const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); throw new Error(`tx failed ${JSON.stringify(st.err)}\n${(t?.meta?.logMessages ?? []).slice(-10).join("\n")}`); } if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig; await sleep(700); }
  return sig;
}
/** null = would succeed; a number = the rule that refused it; a string = the program's error name */
async function sim(tx: Transaction, feePayer: PublicKey): Promise<null | number | string> {
  const r = await conn.simulateTransaction(new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: (await conn.getLatestBlockhash()).blockhash, instructions: tx.instructions }).compileToV0Message()), { sigVerify: false, replaceRecentBlockhash: true });
  if (!r.value.err) return null;
  const logs = (r.value.logs ?? []).join("\n");
  return refusedRule(logs) ?? logs.match(/Error Code: (\w+)/)?.[1] ?? logs.split("\n").slice(-5).join(" | ");
}
const ata = (mint: PublicKey, w: PublicKey) => getAssociatedTokenAddressSync(mint, w, false, TOKEN_2022_PROGRAM_ID);
const bal = async (mint: PublicKey, w: PublicKey) => { try { return BigInt((await conn.getTokenAccountBalance(ata(mint, w))).value.amount); } catch { return 0n; } };
const rulesOf = async (mint: PublicKey) => decodeRules((await conn.getAccountInfo(rulesPda(mint), "confirmed"))!.data)!;
const textOf = (r: Awaited<ReturnType<typeof rulesOf>>) => decompileRules(r.code, r.keys, r.tz, r.decimals, null, true)!;

const start = await conn.getBalance(payer.publicKey);
console.log(`wallet ${(start / 1e9).toFixed(3)} devnet SOL`);
const [alice, mallory] = [Keypair.generate(), Keypair.generate()];
await send(new Transaction().add(...[alice, mallory, keeper].map((k) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 200_000_000 }))), [payer]);

// ---------- Editable hook: the creator rewrites the rules ----------
console.log("Editable hook");
const V1 = "refuse if is_buy and amount > 1% and not trader is creator    # max 1% per buy";
const node = nodeById("editable")!;
const params = { rules: V1, notice: "0" };
const spec: LaunchSpec = { name: "Editable Test", symbol: "EDIT", description: "", imageFile: null, supply: 1_000_000_000, nodeId: "editable", params, initialMcap: 2, migrationMcap: 1_000_000, decimals: 9 };
const T = await createPoolWithHook(conn, walletOf(payer), node, spec, "");
const mint = new PublicKey(T.mint);
await initializeNode(conn, walletOf(payer), node, mint, { ...spec, params: { ...params, __pool: T.pool } });
{
  const r = await rulesOf(mint);
  const v = await verifyLaunch("editable", T.mint, T.pool, T.config, params);
  ok(r.live && r.edit?.authority.equals(payer.publicKey) && r.edit.count === 0 && r.flags === 15, "launched through the site's code: live, and the creator's wallet is the one that may change the rules");
  ok(v.ok, `passes the listing check as an Editable hook${v.ok ? "" : ": " + v.reason}`);
  const lie = await verifyLaunch("custom", T.mint, T.pool, T.config, params);
  ok(!lie.ok && /can be changed/.test(lie.reason ?? ""), `can't be listed as a fixed Custom hook (${lie.reason})`);
}
await send(new Transaction().add(...[payer, alice, mallory].map((k) => createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(mint, k.publicKey), k.publicKey, mint, TOKEN_2022_PROGRAM_ID))), [payer]);
const buyTx = (m: string, pool: string, k: Keypair, lamports: number) => buildHookSwap(conn, k.publicKey, m, pool, false, BigInt(lamports), 0n);
const sellTx = (m: string, pool: string, k: Keypair, raw: bigint) => buildHookSwap(conn, k.publicKey, m, pool, true, raw, 0n);
// 0.05 SOL buys about 2% of supply at this starting market cap
ok((await sim(await buyTx(T.mint, T.pool, alice, 50_000_000), alice.publicKey)) === 1, "rule set 1: alice's buy of over 1% is refused by rule 1");
async function change(m: PublicKey, authority: Keypair, source: string, delaySec = 0) {
  const c = compileRules(source, { decimals: 9, editable: true });
  if (!c.ok) throw new Error(c.errors[0].message);
  for (const tx of changeRulesTxs({ authority: authority.publicKey, payer: authority.publicKey, mint: m, compiled: c, delaySec })) await send(tx, [authority]);
  return c;
}
{
  // a stranger can't start a change
  const c = compileRules("refuse if is_sell", { decimals: 9, editable: true });
  if (!c.ok) throw new Error("compile");
  const tx = changeRulesTxs({ authority: mallory.publicKey, payer: mallory.publicKey, mint, compiled: c, delaySec: 0 })[0];
  ok((await sim(tx, mallory.publicKey)) === "NotEditor", "a wallet that isn't the creator can't change the rules");
}
const V2 = "timezone Asia/Tokyo\nrefuse if is_buy and amount > 3% and not trader is creator\nrefuse if is_sell and sender_seconds_since_buy < 1h\nrefuse if receiver in [" + mallory.publicKey.toBase58() + "]";
await change(mint, payer, V2);
{
  const r = await rulesOf(mint), t = textOf(r);
  ok(r.edit?.count === 1 && r.nRules === 3 && r.keys.length === 1 && t.rules.length === 3, `the creator replaces the rules in one go (real transaction): change 1, now 3 rules, e.g. "${t.rules[1].explain}"`);
  ok(!(await conn.getAccountInfo(nextPda(mint), "confirmed")), "the working copy is closed and its rent returned");
  ok((await verifyLaunch("editable", T.mint, T.pool, T.config, params)).ok, "still passes the listing check after its rules changed");
}
await send(await buyTx(T.mint, T.pool, alice, 50_000_000), [alice]);
ok((await bal(mint, alice.publicKey)) > 0n, "rule set 2: the same buy now goes through (real trade)");
ok((await sim(await sellTx(T.mint, T.pool, alice, (await bal(mint, alice.publicKey)) / 2n), alice.publicKey)) === 2, "rule set 2: selling within the hour is refused by rule 2, which reads the wallet-history table the token launched with");
ok((await sim(await buyTx(T.mint, T.pool, mallory, 5_000_000), mallory.publicKey)) === 3, "rule set 2: the newly named wallet is blocked by rule 3");
await change(mint, payer, "");
{
  const r = await rulesOf(mint);
  ok(r.edit?.count === 2 && textOf(r).rules.length === 0, "the creator clears the rules entirely (change 2)");
}
await send(await sellTx(T.mint, T.pool, alice, (await bal(mint, alice.publicKey)) / 2n), [alice]);
ok(true, "with no rules, alice sells straight away (real trade)");
{
  const big = Array.from({ length: 60 }, (_, i) => `refuse if is_buy and amount > ${i + 2}% and market_cap < ${1000 + i} SOL and not trader is creator`).join("\n");
  const c = await change(mint, payer, big);
  const r = await rulesOf(mint);
  ok(r.edit?.count === 3 && r.nRules === 60 && Buffer.from(r.code).equals(Buffer.from(c.code)), `a long rule set (${c.bytes} bytes, 60 rules, several transactions) goes in whole: the account grows to fit`);
  await send(await buyTx(T.mint, T.pool, alice, 10_000_000), [alice]);
  ok(true, "and the token still trades (real trade)");
}

// ---------- Keeper-controlled, with a notice period (the DAO hook's on-chain half) ----------
console.log("DAO hook (keeper + notice period)");
const dnode = nodeById("dao")!;
const dparams = { rules: "", notice: "0", minHold: 1_000_000, votesToPass: 3 };
const dspec: LaunchSpec = { ...spec, name: "DAO Test", symbol: "DAOT", nodeId: "dao", params: dparams };
const D = await createPoolWithHook(conn, walletOf(payer), dnode, dspec, "");
const dmint = new PublicKey(D.mint);
{
  // set up by hand so the notice period can be 20 seconds (the launcher offers none, 10 min, 1 h, 24 h)
  const info = (await conn.getAccountInfo(new PublicKey(D.pool), "confirmed"))!;
  const c = compileRules("", { decimals: 9, editable: true });
  if (!c.ok) throw new Error("compile");
  for (const tx of setupRulesTxs({ payer: payer.publicKey, mint: dmint, pool: new PublicKey(D.pool), poolConfig: new PublicKey(info.data.subarray(72, 104)), compiled: c, editable: { authority: keeper.publicKey, delaySec: 20 } })) await send(tx, [payer]);
  const r = await rulesOf(dmint);
  ok(r.live && r.edit?.authority.equals(keeper.publicKey) && r.edit.delaySec === 20 && textOf(r).rules.length === 0, "launched with no rules; only the keeper wallet may change them, after 20 seconds' notice");
  const v = await verifyLaunch("dao", D.mint, D.pool, D.config, { ...dparams, notice: "0" });
  ok(!v.ok && /notice/.test(v.reason ?? ""), `the listing check refuses a notice period that doesn't match the chain (${v.reason})`);
}
await send(new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(dmint, alice.publicKey), alice.publicKey, dmint, TOKEN_2022_PROGRAM_ID)), [payer]);
{
  const c = compileRules("refuse if is_sell", { decimals: 9, editable: true });
  if (!c.ok) throw new Error("compile");
  ok((await sim(changeRulesTxs({ authority: payer.publicKey, payer: payer.publicKey, mint: dmint, compiled: c, delaySec: 20 })[0], payer.publicKey)) === "NotEditor", "the creator can't change a DAO token's rules");
}
const DR = "refuse if is_buy and amount > 0.5% and not trader is creator";
await change(dmint, keeper, DR, 20);
const sealedAt = Date.now();
{
  const n = decodeNext((await conn.getAccountInfo(nextPda(dmint), "confirmed"))!.data)!;
  const pending = decompileRules(n.code, n.keys, n.tz, 9, null, true);
  ok(n.sealed && pending?.rules.length === 1, `the keeper seals a change; it sits on-chain where anyone can read it: "${pending?.rules[0].explain}"`);
  ok((await rulesOf(dmint)).edit?.count === 0, "the live rules haven't changed yet");
  ok((await sim(new Transaction().add(applyRulesIx({ payer: mallory.publicKey, receiver: keeper.publicKey, mint: dmint })), mallory.publicKey)) === "TooEarly", "it can't be applied before the notice period is over");
  await send(await buyTx(D.mint, D.pool, alice, 50_000_000), [alice]);
  ok(true, "meanwhile a 2% buy still goes through under the old rules (real trade)");
}
{
  // the keeper can withdraw a sealed change, and start another
  const before = await conn.getBalance(keeper.publicKey);
  await send(new Transaction().add(cancelRulesIx({ authority: keeper.publicKey, receiver: keeper.publicKey, mint: dmint })), [keeper]);
  ok(!(await conn.getAccountInfo(nextPda(dmint), "confirmed")) && (await conn.getBalance(keeper.publicKey)) > before, "the keeper cancels it and gets the rent back");
  await change(dmint, keeper, DR, 20);
}
void sealedAt;
await sleep(26_000);
{
  const before = await conn.getBalance(keeper.publicKey);
  await send(new Transaction().add(applyRulesIx({ payer: mallory.publicKey, receiver: keeper.publicKey, mint: dmint })), [mallory]);
  const r = await rulesOf(dmint);
  ok(r.edit?.count === 1 && textOf(r).rules.length === 1, "after the notice period anyone can send it into effect (real transaction, sent by a stranger)");
  ok((await conn.getBalance(keeper.publicKey)) > before, "and the rent goes back to the keeper who paid it, not to the sender");
  ok((await sim(await buyTx(D.mint, D.pool, alice, 50_000_000), alice.publicKey)) === 1, "the new rule is in force: a 2% buy is refused by rule 1");
}

for (const k of [alice, mallory, keeper]) { const left = await conn.getBalance(k.publicKey); if (left > 10_000) await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: payer.publicKey, lamports: left - 5_000 })), [k]).catch(() => {}); }
console.log(`\n${fails ? `${fails} FAILED` : "EDITABLE + DAO HOOKS OK"} · net cost ${((start - (await conn.getBalance(payer.publicKey))) / 1e9).toFixed(4)} SOL · tokens ${T.mint} ${D.mint}`);
process.exit(fails ? 1 : 0);
