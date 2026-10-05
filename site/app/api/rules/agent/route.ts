import { runHookAgent, agentConfigured } from "../../../lib/hookAgent";
import { q, hasDb } from "../../../lib/node/db";
import { CLUSTER } from "../../../lib/node/env";
import { nodeById } from "../../../lib/node/nodeTypes";
import { verifiedWallet } from "../../../lib/ideasServer";
import { AI_COST_LAMPORTS, chargeFund } from "../../../lib/editFund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// AI-assisted hook creation (app/lib/hookAgent.ts) for the launcher and the Editable hook's editor.
// Anyone gets a daily allowance. The creator of an Editable hook token, signed in with their wallet,
// is instead charged to that token's own fund (5% of its trading fees) for as long as it has SOL.

const PER_IP_PER_DAY = 60;
const ALL_PER_DAY = Number(process.env.AGENT_DAILY_CAP || 3000);

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

/** Counts this request against the daily limits; false = over the limit. */
const memory = new Map<string, number>();
async function allow(ip: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  if (!hasDb()) {
    const k = `${day}:${ip}`, n = (memory.get(k) ?? 0) + 1;
    memory.set(k, n);
    return n <= PER_IP_PER_DAY;
  }
  await q(`CREATE TABLE IF NOT EXISTS hooked.agent_usage (who TEXT NOT NULL, day DATE NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (who, day))`);
  const bump = async (who: string) => Number((await q<{ n: number }>(`INSERT INTO hooked.agent_usage (who, day, n) VALUES ($1, $2, 1) ON CONFLICT (who, day) DO UPDATE SET n = hooked.agent_usage.n + 1 RETURNING n`, [who, day]))[0]?.n ?? 1);
  const [mine, all] = [await bump(ip), await bump("*")];
  return mine <= PER_IP_PER_DAY && all <= ALL_PER_DAY;
}

export async function POST(req: Request): Promise<Response> {
  if (!agentConfigured()) return json({ error: "The AI hook builder isn't switched on yet." }, 503);
  let b: { messages?: unknown; rules?: unknown; decimals?: unknown; supply?: unknown; editable?: unknown; mint?: unknown; auth?: unknown };
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const history = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string" && ["user", "assistant"].includes((m as { role?: string }).role ?? ""))
    .slice(-12).map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Say what you want the hook to do." }, 400);
  const token = { decimals: b.decimals === 6 ? 6 : 9, supply: Number(b.supply) > 0 ? Number(b.supply) : 1_000_000_000 };
  const current = typeof b.rules === "string" ? b.rules.slice(0, 20_000) : "";

  // An Editable hook's creator, working on their own token: charged to the token's fund.
  let funded = false;
  let editable = b.editable === true;
  if (typeof b.mint === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b.mint) && hasDb()) {
    const [row] = await q<{ node_id: string; creator: string }>(`SELECT node_id, creator FROM hooked.nodes WHERE mint = $1 AND cluster = $2`, [b.mint, CLUSTER]);
    if (row && nodeById(row.node_id)?.editable) {
      editable = true;
      const wallet = verifiedWallet(b.auth);
      if (wallet && wallet === row.creator && nodeById(row.node_id)?.editable === "creator") funded = await chargeFund(b.mint, AI_COST_LAMPORTS, "ai", "AI builder request by the creator").catch(() => false);
    }
  }
  if (!funded) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
    if (!(await allow(ip).catch(() => true))) return json({ error: "That's the limit for today. You can still write and edit rules by hand; come back tomorrow for more AI help." }, 429);
  }

  const r = await runHookAgent({ mode: editable ? "editable" : "fixed", history, current, token });
  if (!r.ok) {
    // nothing was delivered: give the fund its charge back
    if (funded) await chargeFund(String(b.mint), -AI_COST_LAMPORTS, "ai", "refund: the AI didn't answer").catch(() => {});
    return json({ error: r.error }, r.status);
  }
  return json({ reply: r.reply, ...(r.rules !== undefined ? { rules: r.rules, explain: r.explain } : {}), tests: r.tests, funded });
}
