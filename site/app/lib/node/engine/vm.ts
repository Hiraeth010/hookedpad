import { OP, SIGNALS, F_IXS, MAX_RULES, MAX_STACK, NEVER } from "./spec";
import { memoText, type Compiled } from "./lang";

// The rules engine's VM in JavaScript, mirroring programs/rules (run + validate) step for step, so
// a rule set can be tested against a made-up transfer before anything touches the chain.

const B = (n: number | string | bigint) => BigInt(n);
const I128_MAX = (B(1) << B(127)) - B(1), I128_MIN = -(B(1) << B(127));
const sat = (v: bigint) => (v > I128_MAX ? I128_MAX : v < I128_MIN ? I128_MIN : v);
/** Rust's truncating division */
const tdiv = (a: bigint, b: bigint) => (b === B(0) ? B(0) : sat(a / b));
const trem = (a: bigint, b: bigint) => (b === B(0) ? B(0) : a % b);

export type Env = {
  sig: bigint[]; supply: bigint;
  /** sender, receiver, trader, signer */
  who: string[];
  keys: string[]; signers: string[]; programs: string[];
  /** the top-level instruction the transfer runs inside: its program and the accounts it lists */
  tradeProgram?: string; tradeAccounts?: string[];
  /** the text of the transaction's memo instructions */
  memos?: string[];
};

/** Runs validated bytecode. `refusedBy` is the 1-based number of the rule that said no. */
export function runCode(code: Uint8Array, env: Env): { ok: true } | { ok: false; refusedBy: number } {
  const st: bigint[] = [];
  let pc = 0, rule = 0;
  const le = (n: number) => { let v = B(0); for (let i = 0; i < n; i++) v |= B(code[pc + i]) << B(8 * i); pc += n; return v; };
  while (pc < code.length) {
    const o = code[pc++];
    switch (o) {
      case OP.PUSH0: st.push(B(0)); break;
      case OP.PUSH1: st.push(B(1)); break;
      case OP.PUSH_U8: st.push(le(1)); break;
      case OP.PUSH_U16: st.push(le(2)); break;
      case OP.PUSH_U32: st.push(le(4)); break;
      case OP.PUSH_U64: st.push(le(8)); break;
      case OP.PCT: st.push(tdiv(sat(env.supply * le(4)), B(1_000_000))); break;
      case OP.LOAD: st.push(env.sig[code[pc++]] ?? B(0)); break;
      case OP.NEG: st.push(sat(-st.pop()!)); break;
      case OP.NOT: st.push(st.pop() === B(0) ? B(1) : B(0)); break;
      case OP.KEY_IS: st.push(env.who[code[pc]] === env.keys[code[pc + 1]] ? B(1) : B(0)); pc += 2; break;
      case OP.KEY_IN: {
        const w = env.who[code[pc]], n = code[pc + 1];
        st.push(Array.from(code.slice(pc + 2, pc + 2 + n)).some((i) => env.keys[i] === w) ? B(1) : B(0));
        pc += 2 + n;
        break;
      }
      case OP.SIGNED_BY: st.push(env.signers.includes(env.keys[code[pc++]]) ? B(1) : B(0)); break;
      case OP.USES_PROGRAM: st.push(env.programs.includes(env.keys[code[pc++]]) ? B(1) : B(0)); break;
      case OP.TRADE_PROGRAM_IS: st.push(env.tradeProgram === env.keys[code[pc++]] ? B(1) : B(0)); break;
      case OP.TRADE_LISTS: st.push((env.tradeAccounts ?? []).includes(env.keys[code[pc++]]) ? B(1) : B(0)); break;
      case OP.MEMO_IS: { const text = memoText(env.keys[code[pc++]]); st.push(text && (env.memos ?? []).includes(text) ? B(1) : B(0)); break; }
      case OP.REFUSE_IF: rule++; if (st.pop() !== B(0)) return { ok: false, refusedBy: rule }; break;
      case OP.REQUIRE: rule++; if (st.pop() === B(0)) return { ok: false, refusedBy: rule }; break;
      default: {
        const b = st.pop()!, a = st.pop()!;
        const t = (x: boolean) => (x ? B(1) : B(0));
        st.push(
          o === OP.ADD ? sat(a + b) : o === OP.SUB ? sat(a - b) : o === OP.MUL ? sat(a * b) : o === OP.DIV ? tdiv(a, b) : o === OP.MOD ? trem(a, b)
          : o === OP.MIN ? (a < b ? a : b) : o === OP.MAX ? (a > b ? a : b)
          : o === OP.LT ? t(a < b) : o === OP.GT ? t(a > b) : o === OP.LE ? t(a <= b) : o === OP.GE ? t(a >= b) : o === OP.EQ ? t(a === b) : o === OP.NE ? t(a !== b)
          : o === OP.AND ? t(a !== B(0) && b !== B(0)) : o === OP.OR ? t(a !== B(0) || b !== B(0)) : B(0));
      }
    }
  }
  return { ok: true };
}

const FLAG_OF = new Map(Object.values(SIGNALS).map((s) => [s.id, s.flag]));
/** The engine's own check of a program (as `validate` in the Rust). Returns the number of rules, or null. */
export function validateCode(code: Uint8Array, nKeys: number, flags: number): number | null {
  let pc = 0, depth = 0, rules = 0;
  const at = (i: number) => (i < code.length ? code[i] : null);
  while (pc < code.length) {
    const o = code[pc++];
    let pops = 0, pushes = 1, operands = 0;
    if (o === OP.PUSH0 || o === OP.PUSH1) { /* one value */ }
    else if (o === OP.PUSH_U8) operands = 1;
    else if (o === OP.PUSH_U16) operands = 2;
    else if (o === OP.PUSH_U32 || o === OP.PCT) operands = 4;
    else if (o === OP.PUSH_U64) operands = 8;
    else if (o === OP.LOAD) {
      const id = at(pc); if (id === null) return null;
      const f = FLAG_OF.get(id); if (f === undefined || (f !== 0 && !(flags & f))) return null;
      operands = 1;
    } else if ([OP.ADD, OP.SUB, OP.MUL, OP.DIV, OP.MOD, OP.MIN, OP.MAX, OP.LT, OP.GT, OP.LE, OP.GE, OP.EQ, OP.NE, OP.AND, OP.OR].includes(o as never)) pops = 2;
    else if (o === OP.NEG || o === OP.NOT) pops = 1;
    else if (o === OP.KEY_IS) { const w = at(pc), k = at(pc + 1); if (w === null || k === null || w > 3 || k >= nKeys) return null; operands = 2; }
    else if (o === OP.KEY_IN) {
      const w = at(pc), n = at(pc + 1); if (w === null || n === null || w > 3) return null;
      for (let i = 0; i < n; i++) { const k = at(pc + 2 + i); if (k === null || k >= nKeys) return null; }
      operands = 2 + n;
    } else if (o === OP.SIGNED_BY || o === OP.USES_PROGRAM || o === OP.TRADE_PROGRAM_IS || o === OP.TRADE_LISTS || o === OP.MEMO_IS) { const k = at(pc); if (!(flags & F_IXS) || k === null || k >= nKeys) return null; operands = 1; }
    else if (o === OP.REFUSE_IF || o === OP.REQUIRE) { if (depth !== 1) return null; rules++; pops = 1; pushes = 0; }
    else return null;
    pc += operands;
    if (pc > code.length || depth < pops) return null;
    depth = depth - pops + pushes;
    if (depth > MAX_STACK) return null;
  }
  return depth !== 0 || rules === 0 || rules > MAX_RULES ? null : rules;
}

/** A made-up transfer for the simulator. Token amounts are whole tokens or "2.5%" of supply; SOL in
 *  SOL; times in seconds or "15m" / "2h" / "3d"; shares as "50%"; yes/no as true/false or 1/0.
 *  Anything left out is 0, except "time since" signals, which default to never. */
export type SimTransfer = Record<string, number | string | boolean> & {
  sender?: string; receiver?: string; trader?: string; signer?: string;
  signers?: never; programs?: never;
};
export type SimResult = { ok: true } | { ok: false; refusedBy: number; line: number; source: string; explain: string };

const TIME: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
function toRaw(name: string, v: number | string | boolean, supplyRaw: bigint, decimals: number): bigint {
  const ty = SIGNALS[name].ty;
  if (typeof v === "boolean") return v ? B(1) : B(0);
  const str = String(v).trim().toLowerCase();
  const scale = (x: string, mult: bigint) => { const [i, f = ""] = x.split("."); return (B((i || "0") + f) * mult) / B(10) ** B(f.length); };
  const numPart = /^-?[\d_]*\.?\d*/.exec(str)![0].replace(/_/g, ""), unit = str.slice(/^-?[\d_]*\.?\d*/.exec(str)![0].length).trim();
  if (numPart === "" || numPart === "-") throw new Error(`${name}: "${v}" isn't a number`);
  const neg = numPart.startsWith("-"), abs = neg ? numPart.slice(1) : numPart;
  let out: bigint;
  if (unit === "%") out = ty === "ratio" ? scale(abs, B(10_000)) : (supplyRaw * scale(abs, B(10_000))) / B(1_000_000);
  else if (ty === "amount") out = scale(abs, B(10) ** B(decimals));
  else if (ty === "sol") out = scale(abs, B(1_000_000_000));
  else if (ty === "time") out = scale(abs, B(TIME[unit[0]] ?? 1));
  else if (ty === "ratio") out = scale(abs, B(10_000));
  else out = scale(abs, B(1));
  return neg ? -out : out;
}

/** Runs compiled rules against a made-up transfer. Nothing touches the chain. */
export function simulate(c: Compiled, transfer: SimTransfer, token: { supply: number; decimals: number }, tx: { signers?: string[]; programs?: string[]; tradeProgram?: string; tradeAccounts?: string[]; memos?: string[] } = {}): SimResult {
  const supplyRaw = B(Math.floor(token.supply)) * B(10) ** B(token.decimals);
  const sig: bigint[] = Array(64).fill(B(0));
  for (const s of Object.values(SIGNALS)) if (s.never) sig[s.id] = NEVER;
  sig[SIGNALS.supply.id] = supplyRaw;
  for (const [k, v] of Object.entries(transfer)) {
    if (k === "sender" || k === "receiver" || k === "trader" || k === "signer") continue;
    if (!SIGNALS[k]) throw new Error(`Unknown signal "${k}"`);
    sig[SIGNALS[k].id] = toRaw(k, v as number | string | boolean, supplyRaw, token.decimals);
  }
  const buy = sig[SIGNALS.is_buy.id] !== B(0), sell = sig[SIGNALS.is_sell.id] !== B(0);
  if (transfer.is_transfer === undefined) sig[SIGNALS.is_transfer.id] = !buy && !sell ? B(1) : B(0);
  const sender = transfer.sender ?? "", receiver = transfer.receiver ?? "";
  const trader = transfer.trader ?? (buy ? receiver : sender);
  const r = runCode(c.code, { sig, supply: supplyRaw, who: [sender, receiver, trader, transfer.signer ?? sender], keys: c.keys, signers: tx.signers ?? [], programs: tx.programs ?? [], tradeProgram: tx.tradeProgram, tradeAccounts: tx.tradeAccounts, memos: tx.memos });
  if (r.ok) return r;
  const rule = c.rules[r.refusedBy - 1];
  return { ok: false, refusedBy: r.refusedBy, line: rule.line, source: rule.source, explain: rule.explain };
}
