import { q, hasDb } from "./node/db";
import { CLUSTER } from "./node/env";

// The fund each Editable or DAO hook token keeps for changes to its rules.
//
// These tokens' fees are split 15% dev / 5% fund / 80% buyback (every other token: 15% / 85%). The
// 5% never leaves the flywheel wallet until it is spent: this ledger says how much of that wallet's
// SOL belongs to which token, and the flywheel never spends it on buybacks (app/lib/flywheel.ts).
// It pays for:
//   ai  the AI builder's work on that token's rules (a flat charge per request; the SOL is passed
//       on to the dev wallet, which pays the AI bill)
//   tx  what the keeper spends putting a passed vote's rules on-chain (network fees and rent)

/** Tokens launched with these rules have a fund. */
export const FUND_NODE_IDS = ["editable", "dao"];
/** What one AI request costs a token's fund. */
export const AI_COST_LAMPORTS = Math.round(Number(process.env.EDIT_AI_COST_SOL || 0.001) * 1e9);

export type Fund = { credited: number; spent: number; balance: number };

/** Adds claimed fees to a token's fund. */
export async function creditFund(mint: string, lamports: number, note: string): Promise<void> {
  if (!hasDb() || lamports <= 0) return;
  await q(`INSERT INTO hooked.edit_fund (mint, cluster, credited) VALUES ($1,$2,$3) ON CONFLICT (mint) DO UPDATE SET credited = hooked.edit_fund.credited + $3`, [mint, CLUSTER, lamports]);
  await q(`INSERT INTO hooked.edit_fund_log (mint, cluster, kind, lamports, note) VALUES ($1,$2,'credit',$3,$4)`, [mint, CLUSTER, lamports, note]);
}

/** Takes `lamports` from a token's fund if it holds that much; false (and nothing taken) if it doesn't.
 *  A negative amount gives money back (rent returned when a change is applied or cancelled). */
export async function chargeFund(mint: string, lamports: number, kind: "ai" | "tx", note: string): Promise<boolean> {
  if (!hasDb() || lamports === 0) return lamports === 0;
  const rows = lamports > 0
    ? await q(`UPDATE hooked.edit_fund SET spent = spent + $2 WHERE mint = $1 AND cluster = $3 AND credited - spent >= $2 RETURNING mint`, [mint, lamports, CLUSTER])
    : await q(`UPDATE hooked.edit_fund SET spent = spent + $2 WHERE mint = $1 AND cluster = $3 RETURNING mint`, [mint, lamports, CLUSTER]);
  if (!rows.length) return false;
  await q(`INSERT INTO hooked.edit_fund_log (mint, cluster, kind, lamports, note) VALUES ($1,$2,$3,$4,$5)`, [mint, CLUSTER, kind, lamports, note]);
  return true;
}

export async function fundOf(mint: string): Promise<Fund> {
  const [r] = await q<{ credited: string; spent: string }>(`SELECT credited, spent FROM hooked.edit_fund WHERE mint = $1 AND cluster = $2`, [mint, CLUSTER]);
  const credited = Number(r?.credited ?? 0), spent = Number(r?.spent ?? 0);
  return { credited, spent, balance: credited - spent };
}

/** Lamports in the flywheel wallet that belong to tokens' funds (so must not be spent on buybacks). */
export async function fundsHeld(): Promise<number> {
  const [r] = await q<{ held: string }>(`SELECT COALESCE(SUM(credited - spent), 0) AS held FROM hooked.edit_fund WHERE cluster = $1`, [CLUSTER]);
  return Number(r?.held ?? 0);
}

/** Everything funds have been charged for AI work so far (the flywheel passes it on to the dev wallet). */
export async function aiChargedTotal(): Promise<number> {
  const [r] = await q<{ t: string }>(`SELECT COALESCE(SUM(lamports), 0) AS t FROM hooked.edit_fund_log WHERE cluster = $1 AND kind = 'ai'`, [CLUSTER]);
  return Number(r?.t ?? 0);
}
