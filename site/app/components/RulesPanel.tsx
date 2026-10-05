"use client";

import "../lib/bufferShim";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import SolanaProvider from "./SolanaProvider";
import HookBuilder from "./HookBuilder";
import { solscanTx } from "../lib/node/env";
import { compileRules } from "../lib/node/engine/lang";
import { BODY_MAX, TITLE_MAX, cleanText, ideaProblem, type IdeaAuth } from "../lib/ideas";
import { savedAuth, forgetAuth, signIn } from "../lib/signIn";
import type { RulesState } from "../lib/rulesState";
import type { DaoIdea } from "../lib/dao";

// The token page of an Editable or DAO hook token: the rules as they are on-chain right now, who can
// change them, any change waiting out its notice period, the token's fund and the change history.
// The creator of an Editable hook changes the rules here (their wallet signs each change); holders
// of a DAO hook post ideas and vote here, and the keeper carries out what passes.

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false, loading: () => <div className="wallet-skeleton" /> });
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const sol = (lamports: number) => (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
function span(secs: number): string {
  if (secs < 90) return `${Math.max(0, Math.round(secs))} seconds`;
  if (secs < 5400) return `${Math.round(secs / 60)} minutes`;
  if (secs < 172_800) return `${+(secs / 3600).toFixed(1)} hours`;
  return `${+(secs / 86_400).toFixed(1)} days`;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
type Note = { kind: "ok" | "err"; text: string; sig?: string };

export default function RulesPanel({ mint, supply }: { mint: string; supply: number }) {
  return <SolanaProvider><Inner mint={mint} supply={supply} /></SolanaProvider>;
}

function Inner({ mint, supply }: { mint: string; supply: number }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58() ?? "";
  const [s, setS] = useState<RulesState | null>(null);
  const [readAt, setReadAt] = useState(0); // this device's clock when `s` was read
  const [clock, setClock] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number | string>>({});

  const load = useCallback(async () => {
    try {
      const r = (await (await fetch(`/api/rules/state?mint=${mint}`, { cache: "no-store" })).json()) as { state?: RulesState };
      if (r.state) { setS(r.state); setReadAt(Date.now()); }
    } catch { /* keep what's shown */ }
  }, [mint]);
  useEffect(() => {
    let live = true;
    const read = () => { if (live && document.visibilityState === "visible") void load(); };
    // (the first read happens even in a background tab)
    const first = setTimeout(() => { if (live) void load(); }, 0);
    const i = setInterval(read, 15_000), c = setInterval(() => setClock(Date.now()), 1_000);
    return () => { live = false; clearTimeout(first); clearInterval(i); clearInterval(c); };
  }, [load]);

  if (!s) return null;
  const now = s.now + Math.max(0, Math.round(((clock || readAt) - readAt) / 1000));
  const mine = s.mode === "creator" && !!me && me === s.authority;
  const waitLeft = s.pending?.sealed ? s.pending.appliesAt - now : 0;

  /** sends transactions one after another with the connected wallet; resolves to the last signature */
  async function sendAll(build: () => Promise<import("@solana/web3.js").Transaction[]>, done: string, after?: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      let sig = "";
      for (const tx of await build()) {
        sig = await wallet.sendTransaction(tx, connection);
        for (let i = 0; i < 60; i++) {
          const st = (await connection.getSignatureStatuses([sig])).value[0];
          if (st?.err) throw new Error("The transaction failed on-chain.");
          if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
      if (after) await after();
      setNote({ kind: "ok", text: done, sig });
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setNote({ kind: "err", text: /reject|denied|cancel/i.test(m) ? "You cancelled it in your wallet. Nothing changed." : `That didn't go through. ${m.slice(0, 160)}` });
      await load();
    } finally { setBusy(false); }
  }

  const draftRules = String(draft.rules ?? "");
  const compiled = editing ? compileRules(draftRules, { decimals: s.decimals, editable: true }) : null;
  const unchanged = draftRules.trim() === s.rules.source.trim();
  async function putOnChain() {
    if (!compiled?.ok || !wallet.publicKey) return;
    const source = draftRules;
    await sendAll(async () => {
      const { PublicKey } = await import("@solana/web3.js");
      const { changeRulesTxs } = await import("../lib/node/engine/client");
      return changeRulesTxs({ authority: wallet.publicKey!, payer: wallet.publicKey!, mint: new PublicKey(mint), compiled, delaySec: s!.delaySec });
    }, s!.delaySec ? `Sealed. The new rules take effect in ${span(s!.delaySec)}; anyone can send them into effect then.` : "Done. The new rules are live.", async () => {
      // put the text as you wrote it (with its comments) on record; the server checks it against the chain
      await fetch("/api/rules/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint, source }) }).catch(() => {});
      setEditing(false);
    });
  }
  const applyNow = () => sendAll(async () => {
    const { PublicKey, Transaction } = await import("@solana/web3.js");
    const { applyRulesIx } = await import("../lib/node/engine/client");
    return [new Transaction().add(applyRulesIx({ payer: wallet.publicKey!, receiver: new PublicKey(s!.pending!.payer), mint: new PublicKey(mint) }))];
  }, "Done. The new rules are live.");
  const cancel = () => sendAll(async () => {
    const { PublicKey, Transaction } = await import("@solana/web3.js");
    const { cancelRulesIx } = await import("../lib/node/engine/client");
    return [new Transaction().add(cancelRulesIx({ authority: wallet.publicKey!, receiver: new PublicKey(s!.pending!.payer), mint: new PublicKey(mint) }))];
  }, "The waiting change was dropped. The rules are as they were.");
  /** the token and the creator's sign-in go with each AI request, so it is paid from the token's fund */
  async function agentExtra(): Promise<Record<string, unknown>> {
    if (!mine || !wallet.signMessage) return { mint };
    try { return { mint, auth: await signIn(me, wallet.signMessage) }; } catch { return { mint }; }
  }

  return (
    <section className="glass rp">
      <div className="rp-top">
        <h2>Its rules right now</h2>
        <span className="tag">{s.mode === "creator" ? "Editable by its creator" : "Changed by holder vote"}</span>
      </div>
      <p className="rp-lead">
        {s.mode === "creator"
          ? <>This token&apos;s rules are not locked. Its creator ({short(s.authority)}) can replace them at any time, including rules about selling.</>
          : <>This token&apos;s rules are set by its holders. A wallet holding {s.dao!.minHold.toLocaleString("en-US")} tokens or more can post an idea and vote; an idea that reaches {s.dao!.votesToPass.toLocaleString("en-US")} net vote{s.dao!.votesToPass === 1 ? "" : "s"} is written as rules by AI and put on-chain by Hooked&apos;s keeper. Nobody can change them any other way.</>}
        {" "}{s.delaySec ? `A change waits ${span(s.delaySec)} on-chain before it takes effect.` : "A change takes effect straight away."}
        {" "}{s.count === 0 ? "They haven't changed since launch." : `They have changed ${s.count} time${s.count === 1 ? "" : "s"}, last ${span(Math.max(0, now - s.changedAt))} ago.`}
      </p>
      {s.rules.explain.length === 0
        ? <p className="rp-none">No rules right now: every buy, sell and send is allowed.</p>
        : <ol className="rp-rules">{s.rules.explain.map((x, i) => <li key={i}>{x}</li>)}</ol>}
      {s.rules.source && <details className="rp-src"><summary>Rule text</summary><pre className="mono small">{s.rules.source}</pre></details>}

      {s.pending && (
        <div className="rp-pending">
          <b>{s.pending.sealed ? "A change is waiting" : "A change is being written"}</b>
          {s.pending.sealed && (s.pending.explain.length === 0
            ? <p>It removes every rule: all buys, sells and sends would be allowed.</p>
            : <ol className="rp-rules">{s.pending.explain.map((x, i) => <li key={i}>{x}</li>)}</ol>)}
          {s.pending.sealed && <p className="lhelp">{waitLeft > 0 ? `It can take effect in ${span(waitLeft)}.` : "Its notice period is over: anyone can send it into effect."}</p>}
          <div className="rp-actions">
            {s.pending.sealed && waitLeft <= 0 && me && <button type="button" className="btn btn-lure btn-sm" disabled={busy} onClick={applyNow}>{busy ? "Check your wallet…" : "Send it into effect"}</button>}
            {mine && <button type="button" className="btn btn-glass btn-sm" disabled={busy} onClick={cancel}>Drop this change</button>}
          </div>
        </div>
      )}

      <p className="lhelp">
        Fund for rule changes: <b className="tnum">{sol(s.fund.balance)} SOL</b>. 5% of this token&apos;s trading fees goes here and pays for {s.mode === "creator" ? "the creator's AI help with the rules" : "the AI work and the on-chain changes when a vote passes"} ({sol(s.fund.credited)} SOL in, {sol(s.fund.spent)} SOL spent so far).
      </p>

      {s.mode === "creator" && (
        <div className="rp-edit">
          {!editing && (
            <div className="rp-actions">
              {mine
                ? <button type="button" className="btn btn-lure btn-sm" disabled={!!s.pending} onClick={() => { setDraft({ rules: s.rules.source }); setEditing(true); setNote(null); }}>Change the rules</button>
                : <span className="lhelp">{me ? "Only the creator's wallet can change the rules." : "Creator? Connect your wallet to change the rules."}</span>}
              {!mine && <WalletMultiButton />}
            </div>
          )}
          {mine && s.pending && !editing && <p className="lhelp">Send the waiting change into effect or drop it before starting another.</p>}
          {editing && compiled && (
            <>
              <HookBuilder params={draft} setParam={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} decimals={s.decimals} supply={supply} editable live={{ histCap: s.histCap }} agentExtra={agentExtra} />
              <p className="lhelp">AI requests are paid from this token&apos;s fund while it has SOL (you&apos;ll sign a free message once so the site knows it&apos;s you); after that the normal daily allowance applies. Putting the rules on-chain is {compiled.ok && compiled.bytes > 600 ? "a few wallet approvals" : "one wallet approval"} and costs only the network fee.</p>
              <div className="rp-actions">
                <button type="button" className="btn btn-lure btn-sm" disabled={busy || !compiled.ok || unchanged} onClick={putOnChain}>{busy ? "Check your wallet…" : s.delaySec ? "Seal these rules on-chain" : "Put these rules on-chain"}</button>
                <button type="button" className="btn btn-glass btn-sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
                {unchanged && <span className="lhelp">These are the rules the token already has.</span>}
              </div>
            </>
          )}
        </div>
      )}
      {note && <p className={note.kind === "ok" ? "idea-ok" : "lwarn"} aria-live="polite">{note.text}{note.sig && <> <a href={solscanTx(note.sig)} target="_blank" rel="noopener noreferrer">View transaction ↗</a></>}</p>}

      {s.mode === "keeper" && <DaoIdeas mint={mint} state={s} onChange={load} />}

      {s.history.length > 1 && (
        <details className="rp-src">
          <summary>History <span>({s.count} change{s.count === 1 ? "" : "s"})</span></summary>
          {s.history.map((h) => (
            <div key={h.n} className="rp-hist">
              <b>{h.n === 0 ? "At launch" : `Change ${h.n}`}</b> <span>{when(h.at)}{h.idea ? ` · voted in: “${h.idea}”` : ""}</span>
              <pre className="mono small">{h.source.trim() || "(no rules)"}</pre>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

const STATUS: Record<DaoIdea["status"], string> = { open: "Open", sealed: "Passed · waiting to take effect", applied: "Passed · now the rules", failed: "Passed · not carried out" };

function DaoIdeas({ mint, state, onChange }: { mint: string; state: RulesState; onChange: () => void }) {
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const me = publicKey?.toBase58() ?? "";
  const [ideas, setIdeas] = useState<DaoIdea[] | null>(null);
  const [holding, setHolding] = useState<number | null>(null);
  const [admin, setAdmin] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const { minHold, votesToPass } = state.dao!;

  const reload = useCallback(async () => {
    try {
      const r = (await (await fetch(`/api/dao?mint=${mint}${me ? `&wallet=${me}` : ""}`, { cache: "no-store" })).json()) as { ideas?: DaoIdea[]; holding?: number | null; admin?: boolean };
      setIdeas(r.ideas ?? []); setHolding(r.holding ?? null); setAdmin(!!r.admin);
    } catch { /* keep what's shown */ }
  }, [mint, me]);
  useEffect(() => {
    let live = true;
    const read = () => { if (live && document.visibilityState === "visible") void reload(); };
    const first = setTimeout(() => { if (live) void reload(); }, 0);
    const i = setInterval(read, 20_000);
    return () => { live = false; clearTimeout(first); clearInterval(i); };
  }, [reload]);

  async function post(path: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!me) { setVisible(true); setNote({ kind: "err", text: "Connect your wallet first, then try again." }); return null; }
    if (!savedAuth(me) && !signMessage) { setNote({ kind: "err", text: "This wallet can't sign messages. Try Phantom, Solflare or Backpack." }); return null; }
    let a: IdeaAuth;
    try { a = await signIn(me, signMessage!); } catch { setNote({ kind: "err", text: "You need to sign the message to post or vote. It's free and doesn't send a transaction." }); return null; }
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auth: a, ...data }) });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) forgetAuth();
    if (!res.ok) { setNote({ kind: "err", text: String(out.error ?? "That didn't go through. Try again.") }); return null; }
    return out;
  }
  const t = cleanText(title, TITLE_MAX + 20, true), b = cleanText(body, BODY_MAX + 50, false);
  const problem = t ? ideaProblem(t, b) : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !t || problem) return;
    setBusy(true); setNote(null);
    try {
      const out = await post("/api/dao", { mint, title: t, body: b });
      if (out) { setTitle(""); setBody(""); setNote({ kind: "ok", text: "Your idea is up. It starts with your upvote." }); await reload(); }
    } finally { setBusy(false); }
  }
  async function vote(idea: DaoIdea, dir: 1 | -1) {
    const next = idea.mine === dir ? 0 : dir;
    setNote(null);
    const out = await post("/api/dao/vote", { id: idea.id, vote: next });
    if (out) { setIdeas((list) => (list ?? []).map((x) => (x.id === idea.id ? { ...x, up: Number(out.up), down: Number(out.down), mine: next as DaoIdea["mine"] } : x))); onChange(); }
  }
  async function remove(idea: DaoIdea) {
    if (!window.confirm(`Remove "${idea.title}"?`)) return;
    const out = await post("/api/dao/vote", { id: idea.id, hide: true });
    if (out) setIdeas((list) => (list ?? []).filter((x) => x.id !== idea.id));
  }
  const open = (ideas ?? []).filter((x) => x.status === "open").sort((x, y) => (y.up - y.down) - (x.up - x.down) || Date.parse(y.createdAt) - Date.parse(x.createdAt));
  const decided = (ideas ?? []).filter((x) => x.status !== "open").sort((x, y) => Date.parse(y.decidedAt ?? y.createdAt) - Date.parse(x.decidedAt ?? x.createdAt));
  const can = holding !== null && holding >= minHold;

  return (
    <div className="rp-dao">
      <form className="idea-form rp-form" onSubmit={submit}>
        <div className="idea-form-top">
          <h3>Propose a change to the rules</h3>
          <WalletMultiButton />
        </div>
        <label className="field" htmlFor="dao-title">The change, in one line
          <input id="dao-title" type="text" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cap every buy at 1% of supply" />
        </label>
        <label className="field" htmlFor="dao-body"><span>How it should work <span className="idea-opt">(optional)</span></span>
          <textarea id="dao-body" rows={3} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should the token allow or refuse, and when? Say what to keep and what to change." />
        </label>
        <div className="idea-form-foot">
          <span className="lhelp">
            {!connected ? `Connect a wallet holding ${minHold.toLocaleString("en-US")} tokens or more to post and vote. Reading is open to everyone.`
              : holding === null ? "Checking your balance…"
              : can ? `This wallet holds ${Math.floor(holding).toLocaleString("en-US")} tokens, so it can post and vote. You'll sign one free message, not a transaction.`
              : `This wallet holds ${Math.floor(holding).toLocaleString("en-US")} tokens. It needs ${minHold.toLocaleString("en-US")} to post or vote.`}
          </span>
          <button type="submit" className="btn btn-lure btn-sm" disabled={busy || !t || !!problem || (connected && holding !== null && !can)}>{busy ? "Check your wallet…" : "Post idea"}</button>
        </div>
        {problem && <p className="lwarn">{problem}</p>}
        {note && <p className={note.kind === "ok" ? "idea-ok" : "lwarn"} aria-live="polite">{note.text}</p>}
      </form>

      {ideas !== null && open.length === 0 && <p className="rp-none">No open ideas. Post the first one.</p>}
      <ol className="idea-list">
        {open.map((x) => (
          <li key={x.id} className="idea rp-idea">
            <div className="idea-votes">
              <button type="button" className="idea-vote up" aria-pressed={x.mine === 1} aria-label={`Upvote: ${x.title}`} onClick={() => vote(x, 1)}>▲</button>
              <b className="tnum" title={`${x.up} up, ${x.down} down`}>{x.up - x.down}</b>
              <button type="button" className="idea-vote down" aria-pressed={x.mine === -1} aria-label={`Downvote: ${x.title}`} onClick={() => vote(x, -1)}>▼</button>
            </div>
            <div className="idea-main">
              <h3>{x.title}</h3>
              {x.body && <p>{x.body}</p>}
              <span className="idea-meta">
                {x.up - x.down} of {votesToPass.toLocaleString("en-US")} net votes to pass · by {short(x.wallet)}{x.wallet === me ? " (you)" : ""} · {when(x.createdAt)}
                {(admin || x.wallet === me) && <> · <button type="button" className="linkish" onClick={() => remove(x)}>Remove</button></>}
              </span>
              {x.result && <span className="idea-meta rp-result">{x.result}</span>}
            </div>
          </li>
        ))}
      </ol>
      {decided.length > 0 && (
        <details className="rp-src" open={decided.some((x) => x.status === "sealed")}>
          <summary>Votes that passed <span>({decided.length})</span></summary>
          <ol className="idea-list">
            {decided.map((x) => (
              <li key={x.id} className="idea rp-idea">
                <div className="idea-main">
                  <h3>{x.title}</h3>
                  <span className={`idea-meta rp-status is-${x.status}`}>{STATUS[x.status]}{x.decidedAt ? ` · ${when(x.decidedAt)}` : ""} · {x.up} up, {x.down} down</span>
                  {x.result && <p>{x.result}</p>}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
