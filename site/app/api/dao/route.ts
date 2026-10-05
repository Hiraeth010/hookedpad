import { q, hasDb } from "../../lib/node/db";
import { CLUSTER } from "../../lib/node/env";
import { BODY_MAX, TITLE_MAX, cleanText, ideaProblem } from "../../lib/ideas";
import { verifiedWallet, isAdmin, json } from "../../lib/ideasServer";
import { daoToken, holdingOf, serverConnection } from "../../lib/daoServer";
import type { DaoIdea, DaoStatus } from "../../lib/dao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A DAO hook token's ideas. GET lists them (anyone); POST submits one (needs a wallet's signed
// sign-in, and that wallet must hold the token's minimum).

type Row = { id: string; wallet: string; title: string; body: string; created_at: string; status: string; result: string | null; decided_at: string | null; up: string; down: string; mine: number | null };

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = hasDb() ? await daoToken(url.searchParams.get("mint") ?? "") : null;
  if (!token) return json({ ok: false, ideas: [] }, 404);
  const wallet = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.searchParams.get("wallet") ?? "") ? url.searchParams.get("wallet")! : "";
  const rows = await q<Row>(
    `SELECT i.id, i.wallet, i.title, i.body, i.created_at, i.status, i.result, i.decided_at,
            COUNT(*) FILTER (WHERE v.vote = 1) AS up, COUNT(*) FILTER (WHERE v.vote = -1) AS down,
            MAX(CASE WHEN v.wallet = $3 THEN v.vote END) AS mine
       FROM hooked.dao_ideas i LEFT JOIN hooked.dao_votes v ON v.idea_id = i.id
      WHERE i.cluster = $1 AND i.mint = $2 AND NOT i.hidden
      GROUP BY i.id ORDER BY i.created_at DESC LIMIT 300`,
    [CLUSTER, token.mint, wallet],
  );
  const ideas: DaoIdea[] = rows.map((r) => ({
    id: Number(r.id), wallet: r.wallet, title: r.title, body: r.body, createdAt: new Date(r.created_at).toISOString(), up: Number(r.up), down: Number(r.down),
    mine: r.mine === 1 ? 1 : r.mine === -1 ? -1 : 0, status: r.status as DaoStatus, result: r.result, decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  }));
  // how much the asking wallet holds, so the page can say whether it may take part
  const holding = wallet ? await holdingOf(serverConnection(), wallet, token.mint).catch(() => null) : null;
  return json({ ok: true, config: { minHold: token.minHold, votesToPass: token.votesToPass }, ideas, holding, admin: !!wallet && isAdmin(wallet) });
}

export async function POST(req: Request): Promise<Response> {
  let b: { auth?: unknown; mint?: unknown; title?: unknown; body?: unknown };
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const wallet = verifiedWallet(b.auth);
  if (!wallet) return json({ error: "Sign in with your wallet again.", signIn: true }, 401);
  const token = hasDb() ? await daoToken(String(b.mint ?? "")) : null;
  if (!token) return json({ error: "That token doesn't take votes." }, 404);
  const title = cleanText(b.title, TITLE_MAX + 20, true), body = cleanText(b.body, BODY_MAX + 50, false);
  const problem = ideaProblem(title, body);
  if (problem) return json({ error: problem }, 422);
  let holding: number;
  try { holding = await holdingOf(serverConnection(), wallet, token.mint); } catch { return json({ error: "Couldn't check your balance just now. Try again." }, 503); }
  if (holding < token.minHold) return json({ error: `You need at least ${token.minHold.toLocaleString("en-US")} tokens to post an idea. This wallet holds ${Math.floor(holding).toLocaleString("en-US")}.` }, 403);
  const dup = await q(`SELECT 1 FROM hooked.dao_ideas WHERE cluster = $1 AND mint = $2 AND NOT hidden AND status = 'open' AND lower(title) = lower($3) LIMIT 1`, [CLUSTER, token.mint, title]);
  if (dup.length) return json({ error: "There's already an open idea with that title. Vote for it instead." }, 409);
  const [row] = await q<{ id: string }>(`INSERT INTO hooked.dao_ideas (cluster, mint, wallet, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [CLUSTER, token.mint, wallet, title, body]);
  // your own idea starts with your upvote
  await q(`INSERT INTO hooked.dao_votes (idea_id, wallet, vote) VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [row.id, wallet]);
  return json({ ok: true, id: Number(row.id) });
}
