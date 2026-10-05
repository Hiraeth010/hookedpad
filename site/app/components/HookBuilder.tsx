"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compileRules } from "../lib/node/engine/lang";
import { simulate } from "../lib/node/engine/vm";
import { DEFAULT_HIST, F_HIST, F_IXS, F_POOL, F_STATE, KING_POOL_FEE, MAX_CODE, MAX_HIST, MIN_HIST, SIGNALS, histBytes, histRentSol } from "../lib/node/engine/spec";

// AI-assisted hook creation, in the launcher's settings step. The creator describes the rule they
// want; the AI (app/api/rules/agent) writes it in Hooked's rule language, checks it with the real
// compiler and tests it. The rules land in an editor the creator can change by hand; everything
// under it (the plain-English reading, the test box) is worked out in the browser by the same
// compiler the launch uses. Saved as params.rules.

export const STARTER_RULES = "refuse if is_buy and amount > 1% and not trader is creator";
const IDEAS = [
  "Max 1% of supply per buy and 2% per wallet",
  "No selling for the first 10 minutes, then wait 15 minutes after each buy before selling",
  "Only trade Monday to Friday, 9am to 5pm New York time",
  "Small buys only until the market cap reaches 500 SOL",
  "Stop bundles and high-fee snipers at launch",
  "A buy limit that grows the longer a wallet holds without selling",
  "King of the Hill, plus a 2% max wallet and no selling in the first 10 minutes",
];
type Test = { label: string; expect: string; got: string; pass: boolean };
type Turn = { role: "user" | "assistant"; content: string; tests?: Test[] };

type Props = {
  params: Record<string, number | string>; setParam: (k: string, v: number | string) => void; decimals: number; supply: number; locked?: boolean;
  /** the rules can be replaced after launch (Editable hook, DAO hook): no King of the Hill, an empty rule set is allowed, and the token always keeps its history table */
  editable?: boolean;
  /** changing a live token's rules (the Editable hook's editor on its token page): the table size was fixed at launch */
  live?: { histCap: number };
  /** extra fields sent with each AI request (the token and the creator's sign-in, so the request is paid from the token's fund) */
  agentExtra?: () => Promise<Record<string, unknown>>;
};

export default function HookBuilder({ params, setParam, decimals, supply, locked, editable, live, agentExtra }: Props) {
  const rules = String(params.rules ?? "");
  useEffect(() => { if (params.rules === undefined) setParam("rules", STARTER_RULES); }, [params.rules, setParam]);
  const histCap = live ? live.histCap : Math.max(MIN_HIST, Math.min(MAX_HIST, Math.round(Number(params.histCap) || DEFAULT_HIST)));
  const compiled = useMemo(() => compileRules(rules, { decimals, histCap, editable }), [rules, decimals, histCap, editable]);

  const [chat, setChat] = useState<Turn[]>([]);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [chat, busy]);

  async function send(text: string) {
    const said = text.trim();
    if (!said || busy) return;
    const next: Turn[] = [...chat, { role: "user", content: said }];
    setChat(next); setAsk(""); setErr(null); setBusy(true);
    try {
      const res = await fetch("/api/rules/agent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), rules, decimals, supply, editable: !!editable, ...(agentExtra ? await agentExtra() : {}) }),
      });
      const out = (await res.json()) as { reply?: string; rules?: string; tests?: Test[]; error?: string };
      if (!res.ok || !out.reply) { setErr(out.error ?? "The AI couldn't answer just now."); return; }
      setChat([...next, { role: "assistant", content: out.reply, tests: out.tests }]);
      if (typeof out.rules === "string") setParam("rules", out.rules);
    } catch {
      setErr("Couldn't reach the AI. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // try a made-up transfer
  const [side, setSide] = useState<"buy" | "sell" | "send">("buy");
  const [pct, setPct] = useState("0.5");
  const [extra, setExtra] = useState("");
  const trial = (() => {
    if (!compiled.ok) return null;
    try {
      const t: Record<string, number | string> = { amount: `${Number(pct) || 0}%` };
      if (side === "buy") { t.is_buy = 1; t.receiver_balance = `${Number(pct) || 0}%`; }
      if (side === "sell") t.is_sell = 1;
      for (const line of extra.split(/[\n,]/)) {
        const m = /^\s*([a-z_]+)\s*[=:]\s*(.+?)\s*$/i.exec(line);
        if (!m) continue;
        if (!SIGNALS[m[1].toLowerCase()]) return { bad: `There's no signal called "${m[1]}".` };
        t[m[1].toLowerCase()] = m[2].replace(/\s*sol$/i, "");
      }
      return simulate(compiled, t, { supply, decimals });
    } catch (e) {
      return { bad: e instanceof Error ? e.message : "Couldn't run that transfer." };
    }
  })();

  return (
    <div className="hb">
      <div className="hb-chat">
        <div className="hb-head"><span className="hb-spark" aria-hidden="true">✦</span><div><b>AI-assisted hook creation</b><span>{live ? "Say what you want to change. The AI rewrites the rules, checks them with the real compiler and tests them. Nothing changes on-chain until you send it." : "Say what you want your token to do. The AI writes the rules, checks them with the real compiler and tests them. You can change anything before you launch."}</span></div></div>
        {chat.length > 0 && (
          <div className="hb-log" ref={logRef} aria-live="polite">
            {chat.map((m, i) => (
              <div key={i} className={`hb-msg is-${m.role}`}>
                <p>{m.content}</p>
                {m.tests && m.tests.length > 0 && (
                  <ul className="hb-tests">
                    {m.tests.map((t, j) => <li key={j} className={t.pass ? "ok" : "bad"}>{t.pass ? "✓" : "✕"} {t.label}: {t.got}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {busy && <div className="hb-msg is-assistant is-busy"><p>Writing and testing your rules…</p></div>}
          </div>
        )}
        {chat.length === 0 && (
          <div className="hb-ideas">
            {IDEAS.filter((s) => !editable || !/King of the Hill/.test(s)).map((s) => <button key={s} type="button" className="hb-idea" disabled={busy || locked} onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        <div className="hb-ask">
          <textarea aria-label="Describe the hook you want" rows={2} value={ask} disabled={busy || locked} placeholder={chat.length ? "Ask for a change, or a new rule…" : "Describe the hook you want, in your own words…"}
            onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(ask); } }} />
          <button type="button" className="btn btn-lure btn-sm" disabled={busy || locked || !ask.trim()} onClick={() => send(ask)}>{busy ? "Working…" : "Ask AI"}</button>
        </div>
        {err && <p className="lwarn">{err}</p>}
      </div>

      <label className="field" htmlFor="l-rules">Your rules
        <textarea id="l-rules" rows={Math.min(14, Math.max(4, rules.split("\n").length + 1))} className="mono small hb-code" spellCheck={false} value={rules} onChange={(e) => setParam("rules", e.target.value)} />
      </label>
      {compiled.ok ? (
        <div className="hb-read">
          {compiled.king && (
            <p className="hb-king"><b>♛ King of the Hill is on.</b> The biggest buy of {compiled.king.minBuySol} SOL or more holds the crown and earns about 0.5% of every trade in SOL. A challenger has to beat the King&apos;s buy by {compiled.king.stepPct}%{compiled.king.halfLifeSec ? `, and the bar halves every ${compiled.king.halfLifeSec % 86_400 === 0 ? `${compiled.king.halfLifeSec / 86_400} day(s)` : compiled.king.halfLifeSec % 3600 === 0 ? `${compiled.king.halfLifeSec / 3600} hour(s)` : `${Math.round(compiled.king.halfLifeSec / 60)} minute(s)`}` : ", and the bar never comes down"}. Selling or sending gives the crown up. {compiled.king.creatorCanRule ? "Your own wallet can be King." : "Your own wallet can't be King."} Trades carry a {KING_POOL_FEE.bps / 100}% fee instead of 1%, and the game runs while the token is on its curve, so the Permanent curve keeps it going.</p>
          )}
          {compiled.rules.length === 0 && !compiled.king && <p className="lhelp">No rules: every buy, sell and send is allowed.</p>}
          <ol>{compiled.rules.map((r) => <li key={r.line}>{r.explain}</li>)}</ol>
          <div className="hb-chips">
            <span className="tag ok">Compiles</span>
            <span className="tag">Trades on any DEX</span>
            <span className="tag">{compiled.bytes.toLocaleString("en-US")} of {MAX_CODE.toLocaleString("en-US")} bytes</span>
            {!editable && !!(compiled.flags & F_POOL) && <span className="tag">reads the pool</span>}
            {!editable && !!(compiled.flags & F_IXS) && <span className="tag">reads the transaction</span>}
            {!editable && !!(compiled.flags & F_STATE) && <span className="tag">keeps counters</span>}
            {!!(compiled.flags & F_HIST) && <span className="tag">remembers the last {compiled.histCap.toLocaleString("en-US")} traders</span>}
            {compiled.tzName && <span className="tag">{compiled.tzName.replace(/_/g, " ")} time</span>}
          </div>
          {compiled.tzNote && <p className="lwarn">{compiled.tzNote}</p>}
          {!!(compiled.flags & F_HIST) && !live && (
            <label className="field hb-hist" htmlFor="l-hist">Wallets remembered
              <span className="hb-hist-row">
                <input id="l-hist" type="range" min={MIN_HIST} max={MAX_HIST} step={1000} value={histCap} disabled={locked} onChange={(e) => setParam("histCap", Number(e.target.value))} />
                <b className="tnum">{histCap.toLocaleString("en-US")}</b>
              </span>
              <span className="lhelp">{editable ? "The size of this list is the one thing that's fixed at launch: later rule sets can't make it bigger. " : ""}Rules about a wallet&apos;s own buys and sells use one shared list of the most recent traders. A wallet that falls off the list reads as never having traded. This size costs about {histRentSol(histCap).toFixed(2)} SOL in rent at launch{histBytes(histCap) > 10_240 * 40 ? `, and setting it up takes about ${Math.ceil(histBytes(histCap) / 10_240 / 40) + 1} wallet approvals` : ""}.</span>
            </label>
          )}
          <p className="lhelp">{editable ? "Nothing is exempt unless a rule says so. These rules are the starting point: they can be replaced after launch, as described above." : "Nothing is exempt unless a rule says so, and the rules are fixed at launch: they can never be changed or switched off while the token is on its curve."}</p>
        </div>
      ) : (
        <ul className="hb-errors">
          {compiled.errors.map((e, i) => <li key={i}>Line {e.line}, column {e.col}: {e.message}</li>)}
        </ul>
      )}

      {compiled.ok && (
        <div className="hb-try">
          <b>Try a transfer</b>
          <div className="hb-try-row">
            <div className="hb-seg" role="group" aria-label="Kind of transfer">
              {(["buy", "sell", "send"] as const).map((s) => <button key={s} type="button" className="tog" aria-pressed={side === s} onClick={() => setSide(s)}>{s === "send" ? "Send" : s === "buy" ? "Buy" : "Sell"}</button>)}
            </div>
            <label className="hb-pct">of <input type="number" min="0" step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent of supply" /> % of supply</label>
          </div>
          <input type="text" className="mono small hb-extra" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Other signals, e.g. market_cap = 300, sender_seconds_since_buy = 5m" aria-label="Other signals" />
          {trial && ("bad" in trial
            ? <p className="lwarn">{trial.bad}</p>
            : trial.ok
              ? <p className="hb-verdict ok">✓ Allowed: every rule passes.</p>
              : <p className="hb-verdict bad">✕ Refused by rule {trial.refusedBy}: {trial.explain}</p>)}
        </div>
      )}
    </div>
  );
}
