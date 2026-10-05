import { q, hasDb } from "../../../lib/node/db";
import { CLUSTER } from "../../../lib/node/env";
import { verifiedWallet, isAdmin, json } from "../../../lib/ideasServer";
import { daoToken, holdingOf, serverConnection } from "../../../lib/daoServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One vote per wallet per idea: 1 (up), -1 (down) or 0 (take it back). Needs a signed sign-in and
// the token's minimum holding. With `hide: true` it instead removes the idea (its author, or a
// Hooked moderator), as long as it is still open.
export async function POST(req: Request): Promise<Response> {
  let b: { auth?: unknown; id?: unknown; vote?: unknown; hide?: unknown };
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const wallet = verifiedWallet(b.auth);
  if (!wallet) return json({ error: "Sign in with your wallet again.", signIn: true }, 401);
  if (!hasDb()) return json({ error: "Voting isn't available right now." }, 503);
  const id = Number(b.id), vote = b.vote === 1 ? 1 : b.vote === -1 ? -1 : 0;
  if (!Number.isInteger(id) || id <= 0) return json({ error: "unknown idea" }, 400);
  const [idea] = await q<{ mint: string; status: string; wallet: string }>(`SELECT mint, status, wallet FROM hooked.dao_ideas WHERE id = $1 AND cluster = $2 AND NOT hidden`, [id, CLUSTER]);
  if (!idea) return json({ error: "That idea isn't there any more." }, 404);
  if (idea.status !== "open") return json({ error: "Voting on that idea is over." }, 409);
  if (b.hide === true) {
    if (wallet !== idea.wallet && !isAdmin(wallet)) return json({ error: "Only the wallet that posted an idea can remove it." }, 403);
    await q(`UPDATE hooked.dao_ideas SET hidden = true WHERE id = $1 AND status = 'open'`, [id]);
    return json({ ok: true });
  }
  const token = await daoToken(idea.mint);
  if (!token) return json({ error: "That token doesn't take votes." }, 404);
  if (vote !== 0) {
    let holding: number;
    try { holding = await holdingOf(serverConnection(), wallet, token.mint); } catch { return json({ error: "Couldn't check your balance just now. Try again." }, 503); }
    if (holding < token.minHold) return json({ error: `You need at least ${token.minHold.toLocaleString("en-US")} tokens to vote. This wallet holds ${Math.floor(holding).toLocaleString("en-US")}.` }, 403);
  }
  if (vote === 0) await q(`DELETE FROM hooked.dao_votes WHERE idea_id = $1 AND wallet = $2`, [id, wallet]);
  else await q(`INSERT INTO hooked.dao_votes (idea_id, wallet, vote) VALUES ($1,$2,$3) ON CONFLICT (idea_id, wallet) DO UPDATE SET vote = $3, updated_at = now()`, [id, wallet, vote]);
  const [t] = await q<{ up: string; down: string }>(`SELECT COUNT(*) FILTER (WHERE vote = 1) AS up, COUNT(*) FILTER (WHERE vote = -1) AS down FROM hooked.dao_votes WHERE idea_id = $1`, [id]);
  return json({ ok: true, up: Number(t.up), down: Number(t.down), mine: vote });
}
