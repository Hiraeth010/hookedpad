import { compileRules } from "../../../lib/node/engine/lang";
import { F_HIST, F_IXS, F_POOL, F_STATE } from "../../../lib/node/engine/spec";
import { DEFAULT_DECIMALS } from "../../../lib/node/env";

export const runtime = "nodejs";

// Compiles a rule set (public, no key, CORS on). Returns the bytecode size and a plain-English
// reading of every rule, or the compile errors with their line and column.

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

export async function POST(req: Request): Promise<Response> {
  let b: { rules?: unknown; decimals?: unknown; /** true for an Editable or DAO hook: no King of the Hill, and an empty rule set is allowed */ editable?: unknown };
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  if (typeof b.rules !== "string" || b.rules.length > 20_000) return json({ ok: false, error: "rules must be a string of up to 20,000 characters" }, 400);
  const decimals = b.decimals === 6 ? 6 : b.decimals === 9 ? 9 : DEFAULT_DECIMALS;
  const c = compileRules(b.rules, { decimals, editable: b.editable === true });
  if (!c.ok) return json({ ok: false, errors: c.errors });
  return json({
    ok: true, bytes: c.bytes, rules: c.rules.length, explain: c.rules.map((r) => r.explain), lines: c.rules.map((r) => r.line),
    timezone: c.tzName, note: c.tzNote, namedWallets: c.keys.length, bytecode: Buffer.from(c.code).toString("hex"),
    uses: { pool: !!(c.flags & F_POOL), transaction: !!(c.flags & F_IXS), counters: !!(c.flags & F_STATE), walletHistory: !!(c.flags & F_HIST) },
    tradesOnAnyDex: true,
  });
}
