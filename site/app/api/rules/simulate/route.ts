import { compileRules } from "../../../lib/node/engine/lang";
import { simulate, type SimTransfer } from "../../../lib/node/engine/vm";
import { DEFAULT_DECIMALS } from "../../../lib/node/env";

export const runtime = "nodejs";

// Runs a rule set against a made-up transfer (public, no key, CORS on). Nothing touches the chain.
//   { "rules": "...", "transfer": { "is_buy": 1, "amount": "2.5%" } }
// Token amounts are whole tokens or a "%" of supply, SOL in SOL, times in seconds or "15m".

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

export async function POST(req: Request): Promise<Response> {
  let b: { rules?: unknown; editable?: unknown; transfer?: unknown; decimals?: unknown; supply?: unknown; signers?: unknown; programs?: unknown };
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  if (typeof b.rules !== "string" || b.rules.length > 20_000) return json({ ok: false, error: "rules must be a string of up to 20,000 characters" }, 400);
  const decimals = b.decimals === 6 ? 6 : b.decimals === 9 ? 9 : DEFAULT_DECIMALS;
  const supply = Number(b.supply) > 0 ? Number(b.supply) : 1_000_000_000;
  const c = compileRules(b.rules, { decimals, editable: b.editable === true });
  if (!c.ok) return json({ ok: false, errors: c.errors });
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 32) : []);
  try {
    const r = simulate(c, (b.transfer && typeof b.transfer === "object" ? b.transfer : {}) as SimTransfer, { supply, decimals }, { signers: list(b.signers), programs: list(b.programs) });
    return json(r.ok ? { ok: true } : r);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "could not run the transfer" }, 400);
  }
}
