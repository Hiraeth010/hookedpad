import { hasDb } from "../../../lib/node/db";
import { rulesState, recordSource } from "../../../lib/rulesState";
import { serverConnection } from "../../../lib/daoServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An Editable or DAO hook token's rules as they are on-chain right now (GET), and a way to put a
// rule set's own source text on record once it is on-chain (POST): the source is only stored if it
// compiles to exactly the token's live rules or to the change that is waiting.

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  if (!hasDb()) return json({ error: "not available" }, 503);
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  try {
    const s = await rulesState(serverConnection(), mint);
    return s ? json({ ok: true, state: s }) : json({ error: "This token's rules can't be changed." }, 404);
  } catch {
    return json({ error: "Couldn't read the token's rules just now." }, 503);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!hasDb()) return json({ error: "not available" }, 503);
  let b: { mint?: unknown; source?: unknown };
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (typeof b.mint !== "string" || typeof b.source !== "string" || b.source.length > 20_000) return json({ error: "bad request" }, 400);
  try {
    const n = await recordSource(serverConnection(), b.mint, b.source);
    return n === null ? json({ error: "That text isn't what's on-chain." }, 409) : json({ ok: true, n });
  } catch {
    return json({ error: "Couldn't check the chain just now." }, 503);
  }
}
