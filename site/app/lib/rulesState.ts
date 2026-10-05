import { Connection, PublicKey } from "@solana/web3.js";
import { q } from "./node/db";
import { CLUSTER } from "./node/env";
import { nodeById, daoMinHold, daoVotes } from "./node/nodeTypes";
import { rulesPda, nextPda, decodeRules, decodeNext, type RulesAccount } from "./node/engine/client";
import { compileRules, decompileRules, type Compiled } from "./node/engine/lang";
import { fundOf } from "./editFund";

// The live state of an Editable or DAO hook token's rules, read from the chain: what the rules are
// right now, who can change them, any change waiting out its notice period, the token's fund, and
// the history of changes. Rule text comes from the author's own source when Hooked has it on record
// and it compiles to exactly what's on-chain; otherwise it is read back from the bytecode.

export type RuleText = { source: string; explain: string[] };
export type RulesState = {
  mint: string;
  mode: "creator" | "keeper";
  creator: string;
  authority: string;
  delaySec: number;
  /** how many times the rules have changed since launch, and when they last did (unix seconds, 0 = never) */
  count: number;
  changedAt: number;
  decimals: number;
  histCap: number;
  rules: RuleText;
  pending: (RuleText & { sealed: boolean; sealedAt: number; appliesAt: number; payer: string }) | null;
  fund: { balance: number; credited: number; spent: number };
  history: { n: number; at: string; source: string; idea: string | null }[];
  dao: { minHold: number; votesToPass: number } | null;
  now: number;
};

const same = (c: Compiled, code: Uint8Array, keys: string[], tz: Uint8Array) =>
  Buffer.from(c.code).equals(Buffer.from(code)) && c.keys.join() === keys.join() && Buffer.from(c.tz).equals(Buffer.from(tz));

/** `candidates` are sources Hooked has on record; the first that compiles to exactly this bytecode is used. */
export function ruleText(code: Uint8Array, keys: string[], tz: Uint8Array, decimals: number, candidates: (string | null | undefined)[]): RuleText {
  for (const src of candidates) {
    if (typeof src !== "string") continue;
    const c = compileRules(src, { decimals, editable: true });
    if (c.ok && same(c, code, keys, tz)) return { source: src, explain: c.rules.map((r) => r.explain) };
  }
  const d = decompileRules(code, keys, tz, decimals, null, true);
  return d ? { source: d.source, explain: d.rules.map((r) => r.explain) } : { source: "", explain: [] };
}

export type EditableToken = { mint: string; nodeId: string; mode: "creator" | "keeper"; creator: string; pool: string; params: Record<string, number | string> };
export async function editableToken(mint: string): Promise<EditableToken | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const [r] = await q<{ node_id: string; creator: string; pool: string; params: Record<string, number | string> }>(
    `SELECT node_id, creator, pool, params FROM hooked.nodes WHERE mint = $1 AND cluster = $2 AND pool IS NOT NULL`, [mint, CLUSTER]);
  const mode = r ? nodeById(r.node_id)?.editable : undefined;
  return r && mode ? { mint, nodeId: r.node_id, mode, creator: r.creator, pool: r.pool, params: r.params ?? {} } : null;
}

/** The token's rules account and any change waiting, straight from the chain. */
export async function readRules(conn: Connection, mint: string): Promise<{ live: RulesAccount; next: ReturnType<typeof decodeNext> } | null> {
  const pk = new PublicKey(mint);
  const [cfg, next] = await conn.getMultipleAccountsInfo([rulesPda(pk), nextPda(pk)], "confirmed");
  const live = cfg ? decodeRules(cfg.data) : null;
  return live?.edit ? { live, next: next ? decodeNext(next.data) : null } : null;
}

export async function rulesState(conn: Connection, mint: string): Promise<RulesState | null> {
  const token = await editableToken(mint);
  if (!token) return null;
  const chain = await readRules(conn, mint);
  if (!chain?.live.edit) return null;
  const { live, next } = chain, edit = live.edit!;
  const rows = await q<{ n: number; at: string; source: string; title: string | null }>(
    `SELECT c.n, c.at, c.source, i.title FROM hooked.rule_changes c LEFT JOIN hooked.dao_ideas i ON i.id = c.idea_id WHERE c.mint = $1 ORDER BY c.n DESC LIMIT 50`, [mint]);
  const recorded = (n: number) => rows.find((r) => r.n === n)?.source;
  const launchText = String(token.params.rules ?? "");
  const rules = ruleText(live.code, live.keys, live.tz, live.decimals, [recorded(edit.count), edit.count === 0 ? launchText : null]);
  const fund = await fundOf(mint);
  return {
    mint, mode: token.mode, creator: token.creator, authority: edit.authority.toBase58(), delaySec: edit.delaySec, count: edit.count, changedAt: edit.changedAt,
    decimals: live.decimals, histCap: live.histCap, rules,
    pending: next ? { ...ruleText(next.code, next.keys, next.tz, live.decimals, [recorded(edit.count + 1)]), sealed: next.sealed, sealedAt: next.sealedAt, appliesAt: next.sealedAt + edit.delaySec, payer: next.payer.toBase58() } : null,
    fund,
    // the launch rules, then every change on record (a change made outside the site shows only as the current rules)
    history: [...rows.filter((r) => r.n <= edit.count).map((r) => ({ n: r.n, at: new Date(r.at).toISOString(), source: r.source, idea: r.title })), { n: 0, at: new Date(live.launchedAt * 1000).toISOString(), source: launchText, idea: null }],
    dao: token.mode === "keeper" ? { minHold: daoMinHold(token.params), votesToPass: daoVotes(token.params) } : null,
    now: Math.floor(Date.now() / 1000),
  };
}

/** Puts a rule set's source on record, if it compiles to exactly the token's live rules or to the
 *  change now waiting. Anyone may call this: only the truth is ever stored. Returns the change number. */
export async function recordSource(conn: Connection, mint: string, source: string, ideaId?: number): Promise<number | null> {
  const token = await editableToken(mint);
  const chain = token ? await readRules(conn, mint) : null;
  if (!chain?.live.edit) return null;
  const { live, next } = chain;
  const c = compileRules(source, { decimals: live.decimals, editable: true });
  if (!c.ok) return null;
  const n = same(c, live.code, live.keys, live.tz) ? live.edit!.count : next && same(c, next.code, next.keys, next.tz) ? live.edit!.count + 1 : null;
  if (n === null || n === 0) return n;
  await q(`INSERT INTO hooked.rule_changes (mint, n, source, idea_id) VALUES ($1,$2,$3,$4) ON CONFLICT (mint, n) DO UPDATE SET source = EXCLUDED.source, idea_id = COALESCE(EXCLUDED.idea_id, hooked.rule_changes.idea_id)`, [mint, n, source.slice(0, 20_000), ideaId ?? null]);
  return n;
}
