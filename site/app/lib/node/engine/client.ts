import "../../bufferShim";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { F_HIST, F_KING, RULE_ERROR, histBytes } from "./spec";
import { initEngineKingIx, kingStatePda } from "../king";
import type { Compiled } from "./lang";

// Client for the rules engine program (the on-chain `rules` program): puts a compiled
// rule set on-chain for a token (initialize → write → grow_history → finalize) and reads it back.

export const RULES_PROGRAM = new PublicKey("9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL");
/** where the named wallets and bytecode start: 256 for rule sets made since the volume counters (layout byte 1), 192 before */
const bodyAt = (d: Buffer) => (d[15] === 1 ? 256 : 192);
const WRITE_CHUNK = 700;

const disc = (n: string) => Buffer.from(sha256(`global:${n}`).slice(0, 8));
export const rulesPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("rules"), mint.toBuffer()], RULES_PROGRAM)[0];
export const historyPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("hist"), mint.toBuffer()], RULES_PROGRAM)[0];
const eamlPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("extra-account-metas"), mint.toBuffer()], RULES_PROGRAM)[0];

/** The body the program stores after the header: the named wallets, then the bytecode. */
const bodyOf = (c: Compiled) => Buffer.concat([...c.keys.map((k) => new PublicKey(k).toBuffer()), Buffer.from(c.code)]);

/** Every transaction that switches a rule set on, in order. Small rule sets fit in one; a big
 *  history table takes several (an account grows 10 KB per instruction). The token can't trade
 *  until the last one (finalize) lands. `done` is what's already on-chain from an earlier attempt
 *  (the rules account exists; the table's current size), so a setup that stopped half way picks up
 *  where it left off instead of failing on "already created". */
export function setupRulesTxs(a: { payer: PublicKey; mint: PublicKey; pool: PublicKey; poolConfig: PublicKey; compiled: Compiled; done?: { initialized: boolean; histBytes: number; kingReady?: boolean };
  /** make the rules changeable after launch by this wallet (Editable hook: the creator; DAO hook: the keeper) */ editable?: { authority: PublicKey; delaySec: number } }): Transaction[] {
  const { payer, mint, compiled: c } = a;
  const cfg = rulesPda(mint), hist = historyPda(mint);
  const head = Buffer.alloc(8);
  head[0] = c.flags; head.writeUInt32LE(c.histCap, 1); head[5] = c.keys.length; head.writeUInt16LE(c.code.length, 6);
  const ixs: TransactionInstruction[] = a.done?.initialized ? [] : [new TransactionInstruction({
    programId: RULES_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: cfg, isSigner: false, isWritable: true },
      { pubkey: a.pool, isSigner: false, isWritable: false },
      { pubkey: a.poolConfig, isSigner: false, isWritable: false },
      { pubkey: hist, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("initialize"), head, Buffer.from(c.tz)]),
  })];
  const body = bodyOf(c);
  for (let at = 0; at < body.length; at += WRITE_CHUNK) {
    const part = body.subarray(at, at + WRITE_CHUNK);
    const h = Buffer.alloc(6); h.writeUInt16LE(at, 0); h.writeUInt32LE(part.length, 2);
    ixs.push(new TransactionInstruction({
      programId: RULES_PROGRAM,
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: cfg, isSigner: false, isWritable: true }],
      data: Buffer.concat([disc("write"), h, part]),
    }));
  }
  if (c.flags & F_HIST) {
    // an account grows 10 KB per instruction; it starts at up to 10 KB
    const have = a.done?.initialized ? a.done.histBytes : Math.min(histBytes(c.histCap), 10_240);
    const grows = Math.max(0, Math.ceil((histBytes(c.histCap) - have) / 10_240));
    for (let i = 0; i < grows; i++) ixs.push(new TransactionInstruction({
      programId: RULES_PROGRAM,
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: cfg, isSigner: false, isWritable: false }, { pubkey: hist, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
      data: disc("grow_history"),
    }));
  }
  // the King of the Hill game, when the rules switch it on: set up before the rules go live. It names
  // many more accounts, so it starts a transaction of its own (with finalize).
  let gameIx: TransactionInstruction | null = null;
  if (c.flags & F_KING && c.king && !a.done?.kingReady) { gameIx = initEngineKingIx({ payer, mint, cfg, pool: a.pool, poolConfig: a.poolConfig, ...c.king }); ixs.push(gameIx); }
  // (harmless to send again on a setup that stopped half way: it only writes the same two fields)
  if (a.editable) {
    const d = Buffer.alloc(36); a.editable.authority.toBuffer().copy(d, 0); d.writeUInt32LE(a.editable.delaySec, 32);
    ixs.push(new TransactionInstruction({
      programId: RULES_PROGRAM,
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: cfg, isSigner: false, isWritable: true }],
      data: Buffer.concat([disc("set_editable"), d]),
    }));
  }
  ixs.push(new TransactionInstruction({
    programId: RULES_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: eamlPda(mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: cfg, isSigner: false, isWritable: true },
      { pubkey: hist, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...(c.flags & F_KING ? [{ pubkey: kingStatePda(mint, true), isSigner: false, isWritable: false }] : []),
    ],
    data: disc("finalize"),
  }));
  // pack instructions into as few transactions as fit (a transaction is 1,232 bytes; its accounts and signature take about 400)
  const txs: Transaction[] = [];
  let cur = new Transaction(), size = 0;
  for (const ix of ixs) {
    const cost = ix.data.length + 4 + ix.keys.length;
    if (cur.instructions.length && (size + cost > 720 || cur.instructions.length >= 40 || ix === gameIx)) { txs.push(cur); cur = new Transaction(); size = 0; }
    cur.add(ix); size += cost;
  }
  txs.push(cur);
  return txs;
}

// ---- changing the rules of an editable token ----
export const nextPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("next"), mint.toBuffer()], RULES_PROGRAM)[0];
const SYS = { pubkey: SystemProgram.programId, isSigner: false, isWritable: false };

/** Sends a sealed change into effect (anyone may, once the token's notice period has passed). `receiver` is whoever paid for the change: they get its rent back. */
export function applyRulesIx(a: { payer: PublicKey; receiver: PublicKey; mint: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: RULES_PROGRAM,
    keys: [{ pubkey: a.payer, isSigner: true, isWritable: true }, { pubkey: a.receiver, isSigner: false, isWritable: true }, { pubkey: a.mint, isSigner: false, isWritable: false },
      { pubkey: rulesPda(a.mint), isSigner: false, isWritable: true }, { pubkey: nextPda(a.mint), isSigner: false, isWritable: true }, SYS],
    data: disc("apply"),
  });
}
/** Drops a change that hasn't taken effect yet. Only the wallet that may change the rules can. */
export function cancelRulesIx(a: { authority: PublicKey; receiver: PublicKey; mint: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: RULES_PROGRAM,
    keys: [{ pubkey: a.authority, isSigner: true, isWritable: false }, { pubkey: a.receiver, isSigner: false, isWritable: true }, { pubkey: a.mint, isSigner: false, isWritable: false },
      { pubkey: rulesPda(a.mint), isSigner: false, isWritable: false }, { pubkey: nextPda(a.mint), isSigner: false, isWritable: true }],
    data: disc("cancel"),
  });
}
/** Every transaction that replaces an editable token's rules: propose, write, seal, and (when the token
 *  has no notice period) apply. With a notice period the last step is sent later with applyRulesIx. */
export function changeRulesTxs(a: { authority: PublicKey; payer: PublicKey; mint: PublicKey; compiled: Compiled; delaySec: number }): Transaction[] {
  const { authority, payer, mint, compiled: c } = a;
  const cfg = rulesPda(mint), next = nextPda(mint);
  const head = Buffer.alloc(3 + 14); head[0] = c.keys.length; head.writeUInt16LE(c.code.length, 1); Buffer.from(c.tz).copy(head, 3);
  const editKeys = [{ pubkey: authority, isSigner: true, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: cfg, isSigner: false, isWritable: false }, { pubkey: next, isSigner: false, isWritable: true }];
  const ixs: TransactionInstruction[] = [new TransactionInstruction({
    programId: RULES_PROGRAM,
    keys: [{ pubkey: authority, isSigner: true, isWritable: false }, { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: cfg, isSigner: false, isWritable: false }, { pubkey: next, isSigner: false, isWritable: true }, SYS],
    data: Buffer.concat([disc("propose"), head]),
  })];
  const body = bodyOf(c);
  for (let at = 0; at < body.length; at += WRITE_CHUNK) {
    const part = body.subarray(at, at + WRITE_CHUNK);
    const h = Buffer.alloc(6); h.writeUInt16LE(at, 0); h.writeUInt32LE(part.length, 2);
    ixs.push(new TransactionInstruction({ programId: RULES_PROGRAM, keys: editKeys, data: Buffer.concat([disc("write_next"), h, part]) }));
  }
  ixs.push(new TransactionInstruction({ programId: RULES_PROGRAM, keys: editKeys, data: disc("seal") }));
  if (a.delaySec === 0) ixs.push(applyRulesIx({ payer, receiver: payer, mint }));
  const txs: Transaction[] = [];
  let cur = new Transaction(), size = 0;
  for (const ix of ixs) {
    const cost = ix.data.length + 4 + ix.keys.length;
    if (cur.instructions.length && size + cost > 720) { txs.push(cur); cur = new Transaction(); size = 0; }
    cur.add(ix); size += cost;
  }
  txs.push(cur);
  return txs;
}

export type PendingRules = { sealed: boolean; sealedAt: number; payer: PublicKey; tz: Uint8Array; keys: string[]; code: Uint8Array };
/** The change waiting at ["next", mint], if any. */
export function decodeNext(data: Buffer | Uint8Array): PendingRules | null {
  const d = Buffer.from(data);
  if (d.length < 72 || d.subarray(0, 8).toString() !== "HKNEXT01") return null;
  const nKeys = d[10], codeLen = d.readUInt16LE(12), codeAt = 72 + 32 * nKeys;
  if (d.length < codeAt + codeLen) return null;
  return {
    sealed: d[9] === 1, sealedAt: Number(d.readBigInt64LE(32)), payer: new PublicKey(d.subarray(40, 72)), tz: new Uint8Array(d.subarray(16, 30)),
    keys: Array.from({ length: nKeys }, (_, i) => new PublicKey(d.subarray(72 + 32 * i, 104 + 32 * i)).toBase58()),
    code: new Uint8Array(d.subarray(codeAt, codeAt + codeLen)),
  };
}

export type RulesAccount = {
  live: boolean; flags: number; decimals: number; nRules: number; histCap: number;
  creator: PublicKey; pool: PublicKey; launchedAt: number; tz: Uint8Array;
  keys: string[]; code: Uint8Array;
  holders: number; totalBuys: number; totalSells: number; lastBuyer: PublicKey;
  /** the King of the Hill game runs alongside the rules */
  king: boolean;
  /** set when the rules can change after launch: who may change them, how long a sealed change waits, and how often they have changed */
  edit: { authority: PublicKey; delaySec: number; count: number; changedAt: number } | null;
};
/** cfg: see the layout in programs/rules/src/lib.rs */
export function decodeRules(data: Buffer | Uint8Array): RulesAccount | null {
  const d = Buffer.from(data);
  if (d.length < 192 || d.subarray(0, 8).toString() !== "HKRULES1") return null;
  const BODY = bodyAt(d);
  const nKeys = d[13], codeLen = d.readUInt16LE(16), codeAt = BODY + 32 * nKeys;
  if (d.length < codeAt + codeLen) return null;
  return {
    live: d[10] === 1, flags: d[9], decimals: d[12], nRules: d[14], histCap: d.readUInt32LE(188) || d.readUInt16LE(18),
    creator: new PublicKey(d.subarray(20, 52)), pool: new PublicKey(d.subarray(52, 84)), launchedAt: Number(d.readBigInt64LE(84)),
    tz: new Uint8Array(d.subarray(100, 114)),
    keys: Array.from({ length: nKeys }, (_, i) => new PublicKey(d.subarray(BODY + 32 * i, BODY + 32 * i + 32)).toBase58()),
    code: new Uint8Array(d.subarray(codeAt, codeAt + codeLen)),
    holders: d.readUInt32LE(114), totalBuys: d.readUInt32LE(118), totalSells: d.readUInt32LE(122), lastBuyer: new PublicKey(d.subarray(155, 187)),
    king: (d[9] & F_KING) !== 0,
    edit: BODY === 256 && d.subarray(208, 240).some((b) => b !== 0)
      ? { authority: new PublicKey(d.subarray(208, 240)), delaySec: d.readUInt32LE(240), count: d.readUInt32LE(244), changedAt: Number(d.readBigInt64LE(248)) }
      : null,
  };
}

/** The rule number (1-based) a failed transaction's error or logs name, or null if no rule refused it. */
export function refusedRule(errOrLogs: unknown): number | null {
  const text = typeof errOrLogs === "string" ? errOrLogs : JSON.stringify(errOrLogs ?? "");
  const log = /rules: rule (\d+) refused/.exec(text);
  if (log) return Number(log[1]);
  const m = /"Custom":\s*(\d+)/.exec(text) ?? /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (!m) return null;
  const code = m[0].includes("0x") ? parseInt(m[1], 16) : Number(m[1]);
  return code > RULE_ERROR && code <= RULE_ERROR + 64 ? code - RULE_ERROR : null;
}
