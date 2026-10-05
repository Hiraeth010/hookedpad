import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { q, hasDb } from "./node/db";
import { CLUSTER } from "./node/env";
import { daoMinHold, daoVotes } from "./node/nodeTypes";
import { rulesPda, changeRulesTxs, applyRulesIx, cancelRulesIx } from "./node/engine/client";
import { compileRules } from "./node/engine/lang";
import { readRules, ruleText, recordSource } from "./rulesState";
import { holdingOf } from "./daoServer";
import { runHookAgent, agentConfigured } from "./hookAgent";
import { AI_COST_LAMPORTS, chargeFund, fundOf } from "./editFund";

// Carries out DAO hook votes. Run by the flywheel worker, whose wallet is the only one a DAO token's
// rules account accepts changes from. For each DAO token, one step per run:
//   - a sealed change whose notice period is over is sent into effect;
//   - otherwise the open idea with the most net votes, if it has reached the token's threshold
//     (counting only voters who still hold the minimum), is handed to the AI builder, and the rule
//     set it writes is put on-chain (and sealed, to wait out the notice period if there is one).
// The AI work and the transactions are paid from the token's own fund (app/lib/editFund.ts); an idea
// waits if the fund can't cover them yet. An idea the AI can't turn into rules is closed with the reason.

const MAX_ATTEMPTS = 5;
const MAX_VOTERS = 2_000;
const TX_FEE_LAMPORTS = 10_000; // per transaction, with room for a priority fee

type Send = (conn: Connection, kp: Keypair, tx: Transaction) => Promise<string>;
type IdeaRow = { id: string; wallet: string; title: string; body: string; rules: string | null; summary: string | null; attempts: number; net: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const solOf = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`;

/** Whether any DAO token has an idea that could need work (so a quiet worker makes no RPC calls). */
export async function daoHasWork(): Promise<boolean> {
  if (!hasDb()) return false;
  const r = await q(`SELECT 1 FROM hooked.dao_ideas WHERE cluster = $1 AND status IN ('open', 'sealed') AND NOT hidden LIMIT 1`, [CLUSTER]);
  return r.length > 0;
}

export async function executeDao(conn: Connection, kp: Keypair, send: Send): Promise<{ done: string[] }> {
  const done: string[] = [];
  if (!hasDb()) return { done };
  const tokens = await q<{ mint: string; params: Record<string, number | string> }>(
    `SELECT n.mint, n.params FROM hooked.nodes n LEFT JOIN hooked.pool_stats s ON s.mint = n.mint
      WHERE n.cluster = $1 AND n.node_id = 'dao' AND n.pool IS NOT NULL AND NOT COALESCE(s.graduated, false)
        AND EXISTS (SELECT 1 FROM hooked.dao_ideas i WHERE i.mint = n.mint AND i.status IN ('open', 'sealed') AND NOT i.hidden)`,
    [CLUSTER]).catch(() =>
    // (the indexer's table may not exist yet on a fresh database)
    q<{ mint: string; params: Record<string, number | string> }>(`SELECT mint, params FROM hooked.nodes WHERE cluster = $1 AND node_id = 'dao' AND pool IS NOT NULL`, [CLUSTER]));
  for (const t of tokens) {
    try {
      const note = await step(conn, kp, send, t.mint, t.params ?? {});
      if (note) done.push(`${t.mint}: ${note}`);
    } catch (e) {
      console.error(`dao: ${t.mint}:`, e instanceof Error ? e.message.slice(0, 300) : e);
    }
  }
  return { done };
}

async function step(conn: Connection, kp: Keypair, send: Send, mint: string, params: Record<string, number | string>): Promise<string | null> {
  const chain = await readRules(conn, mint);
  if (!chain?.live.edit || !chain.live.edit.authority.equals(kp.publicKey)) return null; // not ours to change
  const { live, next } = chain, edit = live.edit!;
  const pk = new PublicKey(mint);

  if (next) {
    if (!next.sealed) {
      // left half-written by a run that was cut off: drop it, the idea is still open and will be redone
      await send(conn, kp, new Transaction().add(cancelRulesIx({ authority: kp.publicKey, receiver: next.payer, mint: pk })));
      return "dropped a half-written change";
    }
    if (Date.now() / 1000 < next.sealedAt + edit.delaySec + 3) return null; // still in its notice period
    await send(conn, kp, new Transaction().add(applyRulesIx({ payer: kp.publicKey, receiver: next.payer, mint: pk })));
    const [idea] = await q<{ id: string; rules: string | null }>(`UPDATE hooked.dao_ideas SET status = 'applied', decided_at = now() WHERE mint = $1 AND cluster = $2 AND status = 'sealed' RETURNING id, rules`, [mint, CLUSTER]);
    if (idea?.rules !== null && idea?.rules !== undefined) await recordSource(conn, mint, idea.rules, Number(idea.id)).catch(() => null);
    return `applied change ${edit.count + 1}`;
  }

  // the open ideas that have reached the threshold on the raw count, most net votes first
  const need = daoVotes(params), minHold = daoMinHold(params);
  const cands = await q<IdeaRow>(
    `SELECT i.id, i.wallet, i.title, i.body, i.rules, i.summary, i.attempts, SUM(v.vote) AS net
       FROM hooked.dao_ideas i JOIN hooked.dao_votes v ON v.idea_id = i.id
      WHERE i.cluster = $1 AND i.mint = $2 AND i.status = 'open' AND NOT i.hidden
      GROUP BY i.id HAVING SUM(v.vote) >= $3 ORDER BY SUM(v.vote) DESC, i.created_at ASC LIMIT 3`,
    [CLUSTER, mint, need]);
  for (const idea of cands) {
    // count again with only the wallets that still hold the minimum
    const votes = await q<{ wallet: string; vote: number }>(`SELECT wallet, vote FROM hooked.dao_votes WHERE idea_id = $1 LIMIT $2`, [idea.id, MAX_VOTERS]);
    let net = 0;
    for (const v of votes) {
      if ((await holdingOf(conn, v.wallet, mint).catch(() => 0)) >= minHold) net += v.vote;
      await sleep(60);
    }
    if (net < need) continue;
    return build(conn, kp, send, mint, idea, { live, delaySec: edit.delaySec, count: edit.count });
  }
  return null;
}

async function build(conn: Connection, kp: Keypair, send: Send, mint: string, idea: IdeaRow, c: { live: NonNullable<Awaited<ReturnType<typeof readRules>>>["live"]; delaySec: number; count: number }): Promise<string> {
  const { live } = c;
  const pk = new PublicKey(mint);
  const fail = async (why: string) => { await q(`UPDATE hooked.dao_ideas SET status = 'failed', result = $2, decided_at = now() WHERE id = $1`, [idea.id, why.slice(0, 600)]); return `idea ${idea.id} closed: ${why.slice(0, 80)}`; };
  const wait = async (why: string, attempt = false) => {
    const [r] = await q<{ attempts: number }>(`UPDATE hooked.dao_ideas SET result = $2, attempts = attempts + $3 WHERE id = $1 RETURNING attempts`, [idea.id, why.slice(0, 600), attempt ? 1 : 0]);
    return attempt && (r?.attempts ?? 0) >= MAX_ATTEMPTS ? fail("It passed, but it couldn't be carried out after several tries.") : `idea ${idea.id} waiting: ${why.slice(0, 80)}`;
  };

  // 1. the AI turns the idea into a rule set (once: the result is kept on the idea)
  let rules = idea.rules, summary = idea.summary ?? "";
  if (rules === null) {
    if (!agentConfigured()) return wait("Passed. Waiting for the AI builder.");
    if (!(await chargeFund(mint, AI_COST_LAMPORTS, "ai", `AI builder: idea ${idea.id}`))) {
      return wait(`Passed. Waiting for the token's fund to reach ${solOf(AI_COST_LAMPORTS)} for the AI work (it holds ${solOf((await fundOf(mint)).balance)}).`);
    }
    const prev = await q<{ source: string }>(`SELECT source FROM hooked.rule_changes WHERE mint = $1 AND n = $2`, [mint, c.count]);
    const [launch] = c.count === 0 ? await q<{ rules: string | null }>(`SELECT params->>'rules' AS rules FROM hooked.nodes WHERE mint = $1`, [mint]) : [];
    const current = ruleText(live.code, live.keys, live.tz, live.decimals, [prev[0]?.source, launch?.rules]).source;
    const supply = await conn.getTokenSupply(pk, "confirmed").then((s) => Number(s.value.uiAmount ?? 1e9)).catch(() => 1e9);
    const r = await runHookAgent({
      mode: "vote", current, token: { decimals: live.decimals, supply },
      history: [{ role: "user", content: `<idea>\nTitle: ${idea.title}\nDetails: ${idea.body || "(none given)"}\n</idea>\nCarry out this vote.` }],
    });
    if (!r.ok) {
      await chargeFund(mint, -AI_COST_LAMPORTS, "ai", `refund: the AI didn't answer (idea ${idea.id})`);
      return wait("Passed. The AI builder couldn't be reached; it will be tried again.", true);
    }
    if (r.rules === undefined) return fail(r.reply.replace(/^\s*CANNOT:\s*/i, "") || "The AI builder couldn't turn this idea into rules.");
    rules = r.rules; summary = r.reply;
    await q(`UPDATE hooked.dao_ideas SET rules = $2, summary = $3, result = $3 WHERE id = $1`, [idea.id, rules, summary.slice(0, 600)]);
  }

  // 2. the rule set goes on-chain
  const compiled = compileRules(rules, { decimals: live.decimals, editable: true });
  if (!compiled.ok) return fail("The rule set written for this idea didn't compile.");
  if (Buffer.from(compiled.code).equals(Buffer.from(live.code)) && compiled.keys.join() === live.keys.join() && Buffer.from(compiled.tz).equals(Buffer.from(live.tz))) {
    return fail("The token's rules already do this, so nothing was changed.");
  }
  // (always sealed first; applied straight after when the token has no notice period)
  const txs = changeRulesTxs({ authority: kp.publicKey, payer: kp.publicKey, mint: pk, compiled, delaySec: 1 });
  const cfgInfo = await conn.getAccountInfo(rulesPda(pk), "confirmed");
  const newLen = 256 + 32 * compiled.keys.length + compiled.code.length;
  const growth = Math.max(0, (await conn.getMinimumBalanceForRentExemption(newLen)) - (cfgInfo?.lamports ?? 0));
  const cost = growth + TX_FEE_LAMPORTS * (txs.length + 1);
  if (!(await chargeFund(mint, cost, "tx", `rule change for idea ${idea.id}`))) {
    return wait(`${summary ? `${summary} ` : ""}Waiting for the token's fund to reach ${solOf(cost)} to put it on-chain (it holds ${solOf((await fundOf(mint)).balance)}).`);
  }
  try {
    for (const tx of txs) await send(conn, kp, tx);
  } catch (e) {
    await chargeFund(mint, -cost, "tx", `refund: the change for idea ${idea.id} didn't go through`);
    console.error(`dao: change for idea ${idea.id} failed:`, e instanceof Error ? e.message.slice(0, 300) : e);
    return wait("Passed. Putting it on-chain failed; it will be tried again.", true);
  }
  await q(`UPDATE hooked.dao_ideas SET status = 'sealed', decided_at = now(), result = $2 WHERE id = $1`, [idea.id, summary.slice(0, 600)]);
  await recordSource(conn, mint, rules, Number(idea.id)).catch(() => null);
  if (c.delaySec > 0) return `idea ${idea.id} sealed, applies in ${c.delaySec}s`;
  try {
    await send(conn, kp, new Transaction().add(applyRulesIx({ payer: kp.publicKey, receiver: kp.publicKey, mint: pk })));
    await q(`UPDATE hooked.dao_ideas SET status = 'applied', decided_at = now() WHERE id = $1`, [idea.id]);
    await recordSource(conn, mint, rules, Number(idea.id)).catch(() => null);
    return `idea ${idea.id} applied`;
  } catch {
    return `idea ${idea.id} sealed; it will be applied on the next run`;
  }
}
