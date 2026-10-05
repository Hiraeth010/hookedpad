import { PublicKey } from "@solana/web3.js";
import { OP, SIGNALS, SIGNAL_BY_ID, WHO, WHO_NAME, WHO_PHRASE, WHO_SPECIAL, WEEKDAYS, NAMED_KEYS, F_IXS, F_HIST, F_KING, F_POOL, MAX_CODE, MAX_KEYS, MAX_RULES, MAX_STACK, MAX_HIST, DEFAULT_HIST, OPENSEA_MEMO, type Ty, type KingGame, EDIT_FLAGS } from "./spec";
import { zoneRule, fmtOffset } from "../schedule";

// The rule language: source text ⇄ the rules engine's bytecode (programs/rules).
//
//   timezone America/New_York                      (optional, once: hour, minute, weekday… are local)
//   refuse if is_buy and amount > 1%               (a percent of a token amount is a share of supply)
//   require weekday < sat and hour >= 9 and hour < 17
//   refuse if is_sell and sender_seconds_since_buy < 15 minutes
//   refuse if is_buy and market_cap < 500 SOL and amount > 0.5%
//   require is_sell or receiver in [<address>, <address>]
//   refuse if is_buy and not signed_by fomo
//
// Values are typed (token amounts, SOL, time, shares, plain numbers, yes/no) so `amount > 5 SOL` is
// a compile error rather than a silent bug. A bare number takes the unit of what it is compared
// with: whole tokens, SOL, or seconds. compileRules gives bytecode + a plain-English reading of
// every rule; decompileRules turns on-chain bytecode back into source, so a token's page can show
// its real rules.

export type RuleError = { line: number; col: number; message: string };
export type CompiledRule = { line: number; source: string; kind: "refuse" | "require"; explain: string };
export type Compiled = {
  ok: true; code: Uint8Array; keys: string[]; flags: number; tz: Uint8Array; tzName: string | null; tzNote: string | null;
  histCap: number; rules: CompiledRule[]; bytes: number;
  /** the King of the Hill game, when the rule set switches it on */
  king: KingGame | null;
};
export type CompileResult = Compiled | { ok: false; errors: RuleError[] };

type Unit = "pct" | "tokens" | "sol" | "time" | null;
type Node =
  | { k: "num"; text: string; unit: Unit; mult: bigint; raw?: bigint; ty?: Ty; value?: bigint; col: number }
  | { k: "sig"; name: string; ty?: Ty; col: number }
  | { k: "bin"; op: string; l: Node; r: Node; ty?: Ty; col: number; /** decompiler: a division whose divisor shares the dividend's unit, so the result is a plain number */ ratio?: boolean }
  | { k: "un"; op: "neg" | "not"; e: Node; ty?: Ty; col: number }
  | { k: "key"; who: number; keys: string[]; list: boolean; ty?: Ty; col: number }
  | { k: "tx"; op: TxOp; key: string; ty?: Ty; col: number };
type TxOp = "signed_by" | "uses_program" | "trade_program" | "trade_lists" | "memo";
const TX_OP: Record<TxOp, number> = { signed_by: OP.SIGNED_BY, uses_program: OP.USES_PROGRAM, trade_program: OP.TRADE_PROGRAM_IS, trade_lists: OP.TRADE_LISTS, memo: OP.MEMO_IS };
/** A memo's text travels in the wallet table: up to 32 bytes, zero padded, written like an address. */
function memoKey(text: string, col: number): string {
  const b = Buffer.from(text, "utf8");
  if (!b.length || b.length > 32) throw new Fail(col, "A memo to match must be 1 to 32 characters.");
  return new PublicKey(Buffer.concat([b, Buffer.alloc(32 - b.length)])).toBase58();
}
export function memoText(key: string): string {
  const b = new PublicKey(key).toBuffer();
  let n = 32; while (n > 0 && b[n - 1] === 0) n--;
  return b.subarray(0, n).toString("utf8");
}
type Flex = Ty | "bare" | "pct";

class Fail extends Error { constructor(public col: number, message: string) { super(message); } }
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TIME_UNITS: Record<string, number> = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, w: 604800, week: 604800, weeks: 604800 };
const TY_WORD: Record<Ty, string> = { amount: "a token amount", sol: "an amount of SOL", time: "a length of time", ratio: "a percentage", num: "a number", bool: "a yes/no condition" };
const B = (n: number | string | bigint) => BigInt(n);
const TEN = B(10);

// ---- lexer ----
type Tok = { t: "num" | "id" | "addr" | "op" | "str" | "end"; v: string; col: number };
function lex(src: string, base: number): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "#") break;
    const col = base + i + 1;
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new Fail(col, "This text is missing its closing quote.");
      out.push({ t: "str", v: src.slice(i + 1, end), col }); i = end + 1; continue;
    }
    const word = /^[A-Za-z0-9_]+/.exec(src.slice(i))?.[0];
    if (word && word.length >= 32 && B58.test(word)) { out.push({ t: "addr", v: word, col }); i += word.length; continue; }
    const num = /^\d[\d_]*(\.\d+)?/.exec(src.slice(i))?.[0];
    if (num) { out.push({ t: "num", v: num.replace(/_/g, ""), col }); i += num.length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))?.[0];
    if (id) { out.push({ t: "id", v: id, col }); i += id.length; continue; }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!="].includes(two)) { out.push({ t: "op", v: two, col }); i += 2; continue; }
    if ("<>+-*/()[],%=".includes(c)) { out.push({ t: "op", v: c === "=" ? "==" : c, col }); i++; continue; }
    throw new Fail(col, `Unexpected character "${c}".`);
  }
  out.push({ t: "end", v: "", col: base + src.length + 1 });
  return out;
}

/** the known word closest to a typo (edit distance up to 2, or one containing the other) */
function nearest(word: string): string | undefined {
  const all = [...Object.keys(SIGNALS), ...Object.keys(WHO), "signed_by", "uses_program", "creator", "last_buyer", "and", "or", "not"];
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const best = all.map((w) => [w, dist(word, w)] as const).sort((x, y) => x[1] - y[1])[0];
  if (best[1] <= 2) return best[0];
  return word.length >= 4 ? all.find((w) => w.includes(word) || word.includes(w)) : undefined;
}

// ---- parser ----
function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isId = (v: string) => peek().t === "id" && peek().v.toLowerCase() === v;
  const eat = () => toks[p++];
  const want = (v: string) => { if (!isOp(v)) throw new Fail(peek().col, `Expected "${v}"${peek().t === "end" ? " before the end of the line" : ` but found "${peek().v}"`}.`); return eat(); };

  const keyOf = (): string => {
    const t = eat();
    if (t.t === "addr") { try { return new PublicKey(t.v).toBase58(); } catch { throw new Fail(t.col, `"${t.v}" isn't a valid Solana address.`); } }
    if (t.t === "id" && NAMED_KEYS[t.v.toLowerCase()]) return NAMED_KEYS[t.v.toLowerCase()].address;
    throw new Fail(t.col, `Expected a wallet or program address${t.v ? ` but found "${t.v}"` : ""}. Known names: ${Object.keys(NAMED_KEYS).join(", ")}.`);
  };
  const primary = (): Node => {
    const t = peek();
    if (t.t === "num") {
      eat();
      if (isOp("%")) { eat(); return { k: "num", text: t.v, unit: "pct", mult: B(1), col: t.col }; }
      if (peek().t === "id") {
        const u = peek().v.toLowerCase();
        if (u === "sol") { eat(); return { k: "num", text: t.v, unit: "sol", mult: B(1), col: t.col }; }
        if (u === "token" || u === "tokens") { eat(); return { k: "num", text: t.v, unit: "tokens", mult: B(1), col: t.col }; }
        if (TIME_UNITS[u]) { eat(); return { k: "num", text: t.v, unit: "time", mult: B(TIME_UNITS[u]), col: t.col }; }
      }
      return { k: "num", text: t.v, unit: null, mult: B(1), col: t.col };
    }
    if (isOp("(")) { eat(); const e = or(); want(")"); return e; }
    if (t.t === "id") {
      const id = t.v.toLowerCase();
      eat();
      if (id === "true" || id === "false") return { k: "num", text: id === "true" ? "1" : "0", unit: null, mult: B(1), col: t.col };
      if (WEEKDAYS.includes(id.slice(0, 3)) && /^(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?$/.test(id)) return { k: "num", text: String(WEEKDAYS.indexOf(id.slice(0, 3))), unit: null, mult: B(1), col: t.col };
      if (id === "min" || id === "max") { want("("); const l = or(); want(","); const r = or(); want(")"); return { k: "bin", op: id, l, r, col: t.col }; }
      if (id === "signed_by" || id === "uses_program" || id === "trade_lists") return { k: "tx", op: id, key: keyOf(), col: t.col };
      if (id === "trade_program") { if (!isId("is")) throw new Fail(peek().col, 'Write it as: trade_program is <address>.'); eat(); return { k: "tx", op: "trade_program", key: keyOf(), col: t.col }; }
      if (id === "memo") {
        if (!isId("is")) throw new Fail(peek().col, 'Write it as: memo is "text".'); eat();
        const m = eat();
        if (m.t !== "str") throw new Fail(m.col, 'Put the memo text in quotes, like memo is "hello".');
        return { k: "tx", op: "memo", key: memoKey(m.v, m.col), col: t.col };
      }
      // the apps, spelled out from what their trades look like on-chain
      const tx = (op: TxOp, name: string): Node => ({ k: "tx", op, key: NAMED_KEYS[name].address, col: t.col });
      if (id === "via_fomo") return tx("signed_by", "fomo");
      if (id === "via_opensea") return { k: "bin", op: "or", l: tx("signed_by", "opensea"), r: { k: "tx", op: "memo", key: memoKey(OPENSEA_MEMO, t.col), col: t.col }, col: t.col };
      if (id === "via_pump_app") return { k: "bin", op: "and", l: { k: "bin", op: "and", l: tx("trade_program", "okx_router"), r: tx("trade_lists", "jupiter_app_tag"), col: t.col }, r: { k: "un", op: "not", e: tx("signed_by", "fomo"), col: t.col }, col: t.col };
      if (id in WHO && (isId("is") || isId("in"))) {
        const word = eat().v.toLowerCase();
        const negate = word === "is" && isId("not") ? (eat(), true) : false;
        let n: Node;
        if (word === "in") {
          want("[");
          const keys: string[] = [];
          while (!isOp("]")) { keys.push(keyOf()); if (!isOp("]")) want(","); }
          eat();
          if (!keys.length) throw new Fail(t.col, "The wallet list is empty.");
          n = { k: "key", who: WHO[id], keys, list: true, col: t.col };
        } else if (peek().t === "id" && WHO_SPECIAL[peek().v.toLowerCase()]) {
          const sp = eat().v.toLowerCase(), name = WHO_SPECIAL[sp][id];
          if (!name) throw new Fail(t.col, `"${id} is ${sp}" isn't available; use sender, receiver or trader.`);
          n = { k: "sig", name, col: t.col };
        } else n = { k: "key", who: WHO[id], keys: [keyOf()], list: false, col: t.col };
        return negate ? { k: "un", op: "not", e: n, col: t.col } : n;
      }
      if (SIGNALS[id]) return { k: "sig", name: id, col: t.col };
      const close = nearest(id);
      throw new Fail(t.col, `Unknown word "${t.v}".${close ? ` Did you mean ${close}?` : ""}`);
    }
    throw new Fail(t.col, t.t === "end" ? "The rule ends too early." : `Unexpected "${t.v}".`);
  };
  const unary = (): Node => {
    if (isOp("-")) { const t = eat(); return { k: "un", op: "neg", e: unary(), col: t.col }; }
    return primary();
  };
  const mul = (): Node => {
    let l = unary();
    while (isOp("*") || isOp("/") || isId("mod")) { const t = eat(); l = { k: "bin", op: t.v.toLowerCase(), l, r: unary(), col: t.col }; }
    return l;
  };
  const add = (): Node => {
    let l = mul();
    while (isOp("+") || isOp("-")) { const t = eat(); l = { k: "bin", op: t.v, l, r: mul(), col: t.col }; }
    return l;
  };
  const cmp = (): Node => {
    const l = add();
    if (peek().t === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(peek().v)) { const t = eat(); return { k: "bin", op: t.v, l, r: add(), col: t.col }; }
    return l;
  };
  const not = (): Node => {
    if (isId("not")) { const t = eat(); return { k: "un", op: "not", e: not(), col: t.col }; }
    return cmp();
  };
  const and = (): Node => { let l = not(); while (isId("and")) { const t = eat(); l = { k: "bin", op: "and", l, r: not(), col: t.col }; } return l; };
  function or(): Node { let l = and(); while (isId("or")) { const t = eat(); l = { k: "bin", op: "or", l, r: and(), col: t.col }; } return l; }
  const e = or();
  if (peek().t !== "end") throw new Fail(peek().col, `Unexpected "${peek().v}".`);
  return e;
}

// ---- types ----
const CMP = ["<", ">", "<=", ">=", "==", "!="];
const numLike = (t: Flex) => t === "bare" || t === "num";
function flex(n: Node): Flex {
  switch (n.k) {
    case "num": return n.unit === "pct" ? "pct" : n.unit === "tokens" ? "amount" : n.unit === "sol" ? "sol" : n.unit === "time" ? "time" : "bare";
    case "sig": return SIGNALS[n.name].ty;
    case "key": case "tx": return "bool";
    case "un": return n.op === "not" ? "bool" : flex(n.e);
    case "bin": {
      if (n.op === "and" || n.op === "or" || CMP.includes(n.op)) return "bool";
      const l = flex(n.l), r = flex(n.r);
      if (n.op === "*") {
        // a plain number times a plain number stays flexible, so `15 * 60` can still be seconds
        if (numLike(l)) return r === "pct" ? "amount" : r === "bare" && l === "num" ? "num" : r;
        if (numLike(r)) return l === "pct" ? "amount" : l;
        if (asRatio(n.l) || asRatio(n.r)) return flex(n);
        throw new Fail(n.col, `Can't multiply ${TY_WORD[l === "pct" ? "amount" : l]} by ${TY_WORD[r === "pct" ? "amount" : r]}.`);
      }
      if (n.op === "/" || n.op === "mod") {
        if (n.ratio) return "num";
        if (numLike(r)) return l === "pct" ? "amount" : l;
        const u = unify(l, r, n.col);
        return n.op === "/" ? "num" : u;
      }
      return unify(l, r, n.col);
    }
  }
}
/** set while decompiling: bytecode constants carry no unit, so a bare number may stand for a percentage */
let lenient = false;
/** Decompiler only: `x / <constant>` where x has a unit can be "x divided by a number" (keeps the
 *  unit) or "x divided by the same unit" (a plain number, as in `seconds / 1d`). The bytecode is the
 *  same either way; when the first reading doesn't type-check, switch that division to the second. */
function asRatio(n: Node): boolean {
  if (!lenient || n.k !== "bin" || n.op !== "/" || n.ratio || flex(n.r) !== "bare" || numLike(flex(n.l))) return false;
  n.ratio = true;
  return true;
}
function unify(a: Flex, b: Flex, col: number): Flex {
  if (a === b) return a;
  const one = (x: Flex, y: Flex): Flex | null => {
    if (x === "bare" && y !== "pct" && (y !== "ratio" || lenient)) return y;
    if (x === "pct" && (y === "amount" || y === "ratio")) return y;
    if (lenient && x === "pct" && y === "bare") return "amount";
    return null;
  };
  const r = one(a, b) ?? one(b, a);
  if (r) return r;
  if ((a === "bare" && b === "ratio") || (b === "bare" && a === "ratio")) throw new Fail(col, "Write this as a percentage, like 50%.");
  const w = (t: Flex) => (t === "bare" ? "a plain number" : t === "pct" ? "a percentage" : TY_WORD[t]);
  throw new Fail(col, `These don't match: ${w(a)} and ${w(b)}.`);
}
const settle = (t: Flex, want?: Ty): Ty => (t === "bare" ? (want && (want !== "ratio" || lenient) ? want : "num") : t === "pct" ? (want === "ratio" ? "ratio" : "amount") : t);

/** Parses a decimal string times `mult` into an integer, or fails if it isn't whole. */
function scaled(text: string, mult: bigint, col: number, what: string): bigint {
  const [i, f = ""] = text.split(".");
  const num = B(i + f) * mult, den = TEN ** B(f.length);
  if (num % den !== B(0)) throw new Fail(col, `${text} is too precise for ${what}.`);
  return num / den;
}

/** Fixes every node's type (and every literal's value), checking that the pieces fit. */
function annotate(n: Node, want: Ty | undefined, decimals: number): Ty {
  const ty = ((): Ty => {
    switch (n.k) {
      case "num": {
        const t = settle(flex(n), want);
        if (n.raw !== undefined) n.value = n.raw;
        else if (t === "bool") { if (n.text !== "0" && n.text !== "1") throw new Fail(n.col, "A yes/no condition can only be compared with 0 or 1."); n.value = B(n.text); }
        else if (n.unit === "pct") n.value = scaled(n.text, B(10_000), n.col, "a percentage"); // parts per million
        else if (t === "amount") n.value = scaled(n.text, TEN ** B(decimals), n.col, `a token with ${decimals} decimals`);
        else if (t === "sol") n.value = scaled(n.text, B(1_000_000_000), n.col, "SOL");
        else if (t === "time") n.value = scaled(n.text, n.mult, n.col, "whole seconds");
        else n.value = scaled(n.text, B(1), n.col, "a whole number");
        if (n.value! >= B(1) << B(64) || (n.unit === "pct" && n.value! >= B(1) << B(32))) throw new Fail(n.col, "That number is too large.");
        return t;
      }
      case "sig": return SIGNALS[n.name].ty;
      case "key": case "tx": return "bool";
      case "un": {
        if (n.op === "not") { needBool(n.e, decimals); return "bool"; }
        const t = annotate(n.e, want, decimals);
        if (t === "bool") throw new Fail(n.col, "Can't negate a yes/no condition; use not.");
        return t;
      }
      case "bin": {
        if (n.op === "and" || n.op === "or") { needBool(n.l, decimals); needBool(n.r, decimals); return "bool"; }
        const l = flex(n.l), r = flex(n.r);
        if (CMP.includes(n.op)) {
          const t = settle(unify(l, r, n.col));
          if (t === "bool" && n.op !== "==" && n.op !== "!=") throw new Fail(n.col, "Yes/no conditions can only be compared with == or !=.");
          annotate(n.l, t, decimals); annotate(n.r, t, decimals);
          return "bool";
        }
        if (l === "bool" || r === "bool") throw new Fail(n.col, "Can't do arithmetic on a yes/no condition.");
        if (n.op === "*" || n.op === "/" || n.op === "mod") {
          const t = settle(flex(n), want);
          if (n.ratio) { const u = settle(flex(n.l)); annotate(n.l, u, decimals); annotate(n.r, u, decimals); return "num"; }
          if (n.op === "*") { annotate(n.l, numLike(l) ? "num" : t, decimals); annotate(n.r, numLike(l) ? t : "num", decimals); }
          else if (numLike(r)) { annotate(n.l, t, decimals); annotate(n.r, "num", decimals); }
          else { const u = settle(unify(l, r, n.col)); annotate(n.l, u, decimals); annotate(n.r, u, decimals); }
          return t;
        }
        const t = settle(unify(l, r, n.col), want);
        annotate(n.l, t, decimals); annotate(n.r, t, decimals);
        return t;
      }
    }
  })();
  n.ty = ty;
  return ty;
}
function needBool(n: Node, decimals: number) {
  if (flex(n) !== "bool") throw new Fail(n.col, `This needs to be a yes/no condition, but it's ${TY_WORD[settle(flex(n))]}. Compare it with something (for example "> 0").`);
  annotate(n, "bool", decimals);
}

// ---- code generation ----
const BIN: Record<string, number> = { "+": OP.ADD, "-": OP.SUB, "*": OP.MUL, "/": OP.DIV, mod: OP.MOD, min: OP.MIN, max: OP.MAX, "<": OP.LT, ">": OP.GT, "<=": OP.LE, ">=": OP.GE, "==": OP.EQ, "!=": OP.NE, and: OP.AND, or: OP.OR };
type Out = { code: number[]; keys: string[]; flags: number };
function push(o: Out, v: bigint) {
  if (v === B(0)) return void o.code.push(OP.PUSH0);
  if (v === B(1)) return void o.code.push(OP.PUSH1);
  const le = (bytes: number) => { for (let i = 0; i < bytes; i++) o.code.push(Number((v >> B(8 * i)) & B(255))); };
  if (v < B(256)) { o.code.push(OP.PUSH_U8); le(1); }
  else if (v < B(65536)) { o.code.push(OP.PUSH_U16); le(2); }
  else if (v < B(1) << B(32)) { o.code.push(OP.PUSH_U32); le(4); }
  else { o.code.push(OP.PUSH_U64); le(8); }
}
function keyIndex(o: Out, k: string, col: number): number {
  let i = o.keys.indexOf(k);
  if (i < 0) { if (o.keys.length >= MAX_KEYS) throw new Fail(col, `A rule set can name up to ${MAX_KEYS} wallets.`); i = o.keys.push(k) - 1; }
  return i;
}
function gen(n: Node, o: Out) {
  switch (n.k) {
    case "num":
      if (n.unit === "pct" && n.ty === "amount") { const v = n.value!; o.code.push(OP.PCT, ...[0, 1, 2, 3].map((i) => Number((v >> B(8 * i)) & B(255)))); }
      else push(o, n.value!);
      return;
    case "sig": o.flags |= SIGNALS[n.name].flag; o.code.push(OP.LOAD, SIGNALS[n.name].id); return;
    case "key":
      if (n.list) o.code.push(OP.KEY_IN, n.who, n.keys.length, ...n.keys.map((k) => keyIndex(o, k, n.col)));
      else o.code.push(OP.KEY_IS, n.who, keyIndex(o, n.keys[0], n.col));
      return;
    case "tx": o.flags |= F_IXS; o.code.push(TX_OP[n.op], keyIndex(o, n.key, n.col)); return;
    case "un": gen(n.e, o); o.code.push(n.op === "not" ? OP.NOT : OP.NEG); return;
    case "bin": gen(n.l, o); gen(n.r, o); o.code.push(BIN[n.op]); return;
  }
}
function depthOf(n: Node): number {
  if (n.k === "un") return depthOf(n.e);
  if (n.k === "bin") return Math.max(depthOf(n.l), 1 + depthOf(n.r));
  return 1;
}

// ---- formatting (shared by the plain-English reading and the decompiler) ----
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function dec(v: bigint, places: number): string {
  const s = v.toString().padStart(places + 1, "0");
  const i = s.slice(0, s.length - places), f = places ? s.slice(-places).replace(/0+$/, "") : "";
  return f ? `${i}.${f}` : i;
}
const short = (k: string) => Object.values(NAMED_KEYS).find((x) => x.address === k)?.what ?? `${k.slice(0, 4)}…${k.slice(-4)}`;
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function timeWords(sec: bigint): string {
  for (const [n, w] of [[604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]] as const) if (sec >= B(n) && sec % B(n) === B(0)) { const q = sec / B(n); return `${group(q.toString())} ${w}${q === B(1) ? "" : "s"}`; }
  return `${group(sec.toString())} second${sec === B(1) ? "" : "s"}`;
}
const isWeekdaySig = (n: Node) => n.k === "sig" && (n.name === "weekday" || n.name === "weekday_utc");

function words(n: Node, decimals: number, sibling?: Node): string {
  switch (n.k) {
    case "num": {
      const v = n.value!;
      if (n.unit === "pct") return `${dec(v, 4)}%${n.ty === "amount" ? " of supply" : ""}`;
      if (n.ty === "ratio") return `${dec(v, 4)}%`;
      if (n.ty === "amount") return `${group(dec(v, decimals))} tokens`;
      if (n.ty === "sol") return `${group(dec(v, 9))} SOL`;
      if (n.ty === "time") return timeWords(v);
      if (sibling && isWeekdaySig(sibling) && v < B(7)) return DAY_FULL[Number(v)];
      return group(v.toString());
    }
    case "sig": return SIGNALS[n.name].phrase;
    case "key": return n.list ? `${WHO_PHRASE[n.who]} is one of ${n.keys.length === 1 ? short(n.keys[0]) : `${n.keys.length} listed wallets`}` : `${WHO_PHRASE[n.who]} is ${short(n.keys[0])}`;
    case "tx": return n.op === "signed_by" ? `the transaction is signed by ${short(n.key)}` : n.op === "uses_program" ? `the transaction uses ${short(n.key)}`
      : n.op === "trade_program" ? `the trade runs through ${short(n.key)}` : n.op === "trade_lists" ? `the trade carries ${short(n.key)}` : `the transaction has the memo "${memoText(n.key)}"`;
    case "un": {
      if (n.op === "neg") return `−${words(n.e, decimals)}`;
      const e = n.e;
      if (e.k === "key") return words(e, decimals).replace(" is ", " isn't ");
      if (e.k === "tx") return words(e, decimals).replace(" is signed by ", " isn't signed by ").replace(" uses ", " doesn't use ").replace(" runs through ", " doesn't run through ").replace(" carries ", " doesn't carry ").replace(" has the memo ", " doesn't have the memo ");
      if (e.k === "sig") return SIGNALS[e.name].phrase.replace(/^it's /, "it isn't ").replace(/ is /, " isn't ").replace(/ was /, " wasn't ");
      return `it's not true that ${words(e, decimals)}`;
    }
    case "bin": {
      const l = (x: Node, sib: Node) => (x.k === "bin" && (x.op === "or" || x.op === "and") && x.op !== n.op ? `(${words(x, decimals, sib)})` : words(x, decimals, sib));
      if (n.op === "and" || n.op === "or") return `${l(n.l, n.r)} ${n.op} ${l(n.r, n.l)}`;
      if (CMP.includes(n.op)) {
        const w = { "<": "is under", ">": "is over", "<=": "is at most", ">=": "is at least", "==": "is", "!=": "isn't" }[n.op];
        if (n.l.ty === "bool" && n.r.k === "num") return (n.op === "==") === (n.r.value === B(1)) ? words(n.l, decimals) : words({ k: "un", op: "not", e: n.l, col: 0 }, decimals);
        return `${words(n.l, decimals, n.r)} ${w} ${words(n.r, decimals, n.l)}`;
      }
      if (n.op === "min" || n.op === "max") return `the ${n.op === "min" ? "smaller" : "larger"} of ${words(n.l, decimals)} and ${words(n.r, decimals)}`;
      const sym = { "+": "plus", "-": "minus", "*": "times", "/": "divided by", mod: "modulo" }[n.op];
      return `${words(n.l, decimals)} ${sym} ${words(n.r, decimals)}`;
    }
  }
}

const PREC: Record<string, number> = { or: 1, and: 2, "<": 4, ">": 4, "<=": 4, ">=": 4, "==": 4, "!=": 4, "+": 5, "-": 5, "*": 6, "/": 6, mod: 6 };
/** Renders a typed tree back to source. */
function source(n: Node, decimals: number, parent = 0, sibling?: Node): string {
  switch (n.k) {
    case "num": {
      const v = n.value!;
      if (n.unit === "pct" || n.ty === "ratio") return `${dec(v, 4)}%`;
      if (n.ty === "amount") return `${dec(v, decimals)} tokens`;
      if (n.ty === "sol") return `${dec(v, 9)} SOL`;
      if (n.ty === "time") { for (const [m, u] of [[86400, "d"], [3600, "h"], [60, "m"]] as const) if (v >= B(m) && v % B(m) === B(0)) return `${v / B(m)}${u}`; return `${v}s`; }
      if (sibling && isWeekdaySig(sibling) && v < B(7)) return WEEKDAYS[Number(v)];
      return v.toString();
    }
    case "sig": return n.name;
    case "key": return n.list ? `${WHO_NAME[n.who]} in [${n.keys.join(", ")}]` : `${WHO_NAME[n.who]} is ${n.keys[0]}`;
    case "tx": return n.op === "memo" ? `memo is "${memoText(n.key)}"` : n.op === "trade_program" ? `trade_program is ${n.key}` : `${n.op} ${n.key}`;
    case "un": return n.op === "not" ? (3 < parent ? `(not ${source(n.e, decimals, 3)})` : `not ${source(n.e, decimals, 3)}`) : `-${source(n.e, decimals, 7)}`;
    case "bin": {
      if (n.op === "min" || n.op === "max") return `${n.op}(${source(n.l, decimals)}, ${source(n.r, decimals)})`;
      const p = PREC[n.op];
      // comparisons don't chain, so a comparison inside one always gets brackets
      const s = `${source(n.l, decimals, CMP.includes(n.op) ? p + 1 : p, n.r)} ${n.op} ${source(n.r, decimals, p + 1, n.l)}`;
      return p < parent ? `(${s})` : s;
    }
  }
}

// ---- time zone ----
const UTC_TZ = new Uint8Array(14);
function tzBytes(name: string, col: number): { bytes: Uint8Array; note: string | null; name: string } {
  const raw = /^raw:([0-9a-f]{28})$/i.exec(name);
  if (raw) return { bytes: Uint8Array.from(raw[1].match(/../g)!.map((h) => parseInt(h, 16))), note: null, name };
  if (/^utc$/i.test(name)) return { bytes: UTC_TZ, note: null, name: "UTC" };
  let z;
  try { z = zoneRule(name); new Intl.DateTimeFormat("en-US", { timeZone: name }); } catch { throw new Fail(col, `"${name}" isn't a time zone. Use a name like America/New_York, Europe/London or Asia/Tokyo.`); }
  const b = Buffer.alloc(14);
  b.writeInt16LE(z.stdOff, 0); b.writeInt16LE(z.dstShift, 2);
  if (z.dstShift) for (const [at, r] of [[4, z.dstStart], [9, z.dstEnd]] as const) { b[at] = r.month; b[at + 1] = r.fromDay; b[at + 2] = r.weekday; b.writeInt16LE(r.minute, at + 3); }
  return { bytes: new Uint8Array(b), name, note: z.exact ? null : `${name} moves its clocks on dates that change every year, so the rules use ${fmtOffset(z.stdOff)} all year.` };
}

/** `king_of_the_hill min 0.1 SOL step 5% halves 6h creator no`: every part is optional. */
function kingLine(rest: string, col: number): KingGame {
  const g: KingGame = { minBuySol: 0.1, stepPct: 5, halfLifeSec: 6 * 3600, creatorCanRule: false };
  let left = rest.trim();
  const take = (re: RegExp): RegExpExecArray | null => { const m = re.exec(left); if (m) left = (left.slice(0, m.index) + " " + left.slice(m.index + m[0].length)).trim(); return m; };
  const min = take(/\bmin\s+(\d+(?:\.\d+)?)\s*sol\b/i);
  if (min) g.minBuySol = Number(min[1]);
  const step = take(/\bstep\s+(\d+(?:\.\d+)?)\s*%/i);
  if (step) g.stepPct = Number(step[1]);
  const never = take(/\bhalves\s+never\b/i);
  const halves = never ? null : take(/\bhalves\s+(\d+)\s*([a-z]+)\b/i);
  if (never) g.halfLifeSec = 0;
  if (halves) {
    const u = TIME_UNITS[halves[2].toLowerCase()];
    if (!u) throw new Fail(col, `"${halves[2]}" isn't a unit of time. Use m, h or d.`);
    g.halfLifeSec = Number(halves[1]) * u;
  }
  const creator = take(/\bcreator\s+(yes|no)\b/i);
  if (creator) g.creatorCanRule = creator[1].toLowerCase() === "yes";
  if (left) throw new Fail(col, `Couldn't read "${left}". Write it like: king_of_the_hill min 0.1 SOL step 5% halves 6h creator no`);
  if (g.minBuySol < 0.001) throw new Fail(col, "The smallest buy that can take the crown must be at least 0.001 SOL.");
  if (g.stepPct > 100) throw new Fail(col, "The step a challenger must beat the King by can't be over 100%.");
  if (g.halfLifeSec !== 0 && g.halfLifeSec < 60) throw new Fail(col, "The bar can't halve faster than once a minute.");
  return g;
}
/** The game's line as source. */
export function kingSource(g: KingGame): string {
  const hl = g.halfLifeSec === 0 ? "never" : g.halfLifeSec % 86_400 === 0 ? `${g.halfLifeSec / 86_400}d` : g.halfLifeSec % 3600 === 0 ? `${g.halfLifeSec / 3600}h` : `${Math.round(g.halfLifeSec / 60)}m`;
  return `king_of_the_hill min ${g.minBuySol} SOL step ${g.stepPct}% halves ${hl} creator ${g.creatorCanRule ? "yes" : "no"}`;
}

/** Compiles rule source to the engine's bytecode. `decimals` are the token's (whole-token amounts depend on them). */
export function compileRules(src: string, opts: { decimals: number; histCap?: number; /** for a token whose rules can change (Editable hook, DAO hook) */ editable?: boolean }): CompileResult {
  const errors: RuleError[] = [];
  const o: Out = { code: [], keys: [], flags: 0 };
  const rules: CompiledRule[] = [];
  let tz: { bytes: Uint8Array; note: string | null; name: string } | null = null;
  let king: KingGame | null = null;
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1, text = raw.replace(/#.*$/, "").trim();
    if (!text) return;
    const indent = raw.length - raw.trimStart().length;
    try {
      const z = /^timezone\s+(\S+)$/i.exec(text);
      if (z) { if (tz) throw new Fail(indent + 1, "Only one timezone line is allowed."); tz = tzBytes(z[1], indent + 10); return; }
      const g = /^king_of_the_hill\b(.*)$/i.exec(text);
      if (g && opts.editable) throw new Fail(indent + 1, "King of the Hill can't run on a token whose rules can change: it needs its own trading fee, which is fixed at launch.");
      if (g) { if (king) throw new Fail(indent + 1, "Only one king_of_the_hill line is allowed."); king = kingLine(g[1], indent + 17); o.flags |= F_KING | F_POOL; return; }
      const m = /^(refuse\s+if|require)\s+/i.exec(text);
      if (!m) throw new Fail(indent + 1, 'Every rule starts with "refuse if" or "require".');
      const kind = m[1].toLowerCase().startsWith("refuse") ? "refuse" : "require";
      const tree = parse(lex(text.slice(m[0].length), indent + m[0].length));
      needBool(tree, opts.decimals);
      if (depthOf(tree) > MAX_STACK) throw new Fail(indent + 1, "This rule is nested too deeply.");
      gen(tree, o);
      o.code.push(kind === "refuse" ? OP.REFUSE_IF : OP.REQUIRE);
      const cond = words(tree, opts.decimals);
      rules.push({ line, source: text, kind, explain: kind === "refuse" ? `Refuses the transfer when ${cond}.` : `Only allows the transfer when ${cond}.` });
    } catch (e) {
      if (e instanceof Fail) errors.push({ line, col: e.col, message: e.message }); else throw e;
    }
  });
  if (!errors.length && !king && o.flags & F_KING) errors.push({ line: 1, col: 1, message: "These rules use the King of the Hill signals, so the game has to be switched on: add a line that says king_of_the_hill." });
  // a rule set can be just the game, with no rules of its own: the engine still needs one rule, so add one that never refuses
  if (!errors.length && !rules.length && king) { o.code.push(OP.PUSH0, OP.REFUSE_IF); }
  // a token whose rules can change may start (or be set back to) no rules at all
  if (!errors.length && !rules.length && !king && opts.editable) { o.code.push(OP.PUSH0, OP.REFUSE_IF); }
  if (!errors.length && !rules.length && !king && !opts.editable) errors.push({ line: 1, col: 1, message: 'Write at least one rule: a line starting with "refuse if" or "require".' });
  if (!errors.length && rules.length > MAX_RULES) errors.push({ line: rules[MAX_RULES].line, col: 1, message: `A rule set holds up to ${MAX_RULES} rules.` });
  if (!errors.length && o.code.length > MAX_CODE) errors.push({ line: 1, col: 1, message: `These rules compile to ${o.code.length} bytes; the limit is ${MAX_CODE}.` });
  if (errors.length) return { ok: false, errors };
  const z = tz as { bytes: Uint8Array; note: string | null; name: string } | null;
  if (opts.editable) o.flags = EDIT_FLAGS;
  const histCap = o.flags & F_HIST ? Math.max(16, Math.min(MAX_HIST, Math.round(opts.histCap ?? DEFAULT_HIST))) : 0;
  return { ok: true, code: Uint8Array.from(o.code), keys: o.keys, flags: o.flags, tz: z?.bytes ?? UTC_TZ, tzName: z?.name ?? null, tzNote: z?.note ?? null, histCap, rules, bytes: o.code.length, king: king as KingGame | null };
}

/** Turns on-chain bytecode back into rule source (and a plain-English reading), or null if it isn't a valid program. */
export function decompileRules(code: Uint8Array, keys: string[], tz: Uint8Array, decimals: number, king?: KingGame | true | null, /** an editable token may hold no rules */ emptyOk?: boolean): { source: string; rules: CompiledRule[] } | null {
  lenient = true;
  try {
    const st: Node[] = [], rules: CompiledRule[] = [], lines: string[] = [];
    if (tz.some((b) => b !== 0)) lines.push(`timezone raw:${Buffer.from(tz).toString("hex")}`);
    if (king) lines.push(king === true ? "king_of_the_hill" : kingSource(king));
    const le = (at: number, n: number) => { let v = B(0); for (let i = 0; i < n; i++) v |= B(code[at + i]) << B(8 * i); return v; };
    const BY_OP = Object.fromEntries(Object.entries(BIN).map(([k, v]) => [v, k]));
    const num = (raw: bigint, unit: Unit = null): Node => ({ k: "num", text: "", unit, mult: B(1), raw, col: 0 });
    let pc = 0;
    while (pc < code.length) {
      const op = code[pc++];
      if (op === OP.PUSH0) st.push(num(B(0)));
      else if (op === OP.PUSH1) st.push(num(B(1)));
      else if (op === OP.PUSH_U8) { st.push(num(le(pc, 1))); pc += 1; }
      else if (op === OP.PUSH_U16) { st.push(num(le(pc, 2))); pc += 2; }
      else if (op === OP.PUSH_U32) { st.push(num(le(pc, 4))); pc += 4; }
      else if (op === OP.PUSH_U64) { st.push(num(le(pc, 8))); pc += 8; }
      else if (op === OP.PCT) { st.push(num(le(pc, 4), "pct")); pc += 4; }
      else if (op === OP.LOAD) { const name = SIGNAL_BY_ID[code[pc++]]; if (!name) return null; st.push({ k: "sig", name, col: 0 }); }
      else if (op === OP.NOT || op === OP.NEG) { const e = st.pop(); if (!e) return null; st.push({ k: "un", op: op === OP.NOT ? "not" : "neg", e, col: 0 }); }
      else if (op === OP.KEY_IS) { st.push({ k: "key", who: code[pc], keys: [keys[code[pc + 1]]], list: false, col: 0 }); pc += 2; }
      else if (op === OP.KEY_IN) { const n = code[pc + 1]; st.push({ k: "key", who: code[pc], keys: Array.from(code.slice(pc + 2, pc + 2 + n), (i) => keys[i]), list: true, col: 0 }); pc += 2 + n; }
      else if (op === OP.SIGNED_BY || op === OP.USES_PROGRAM || op === OP.TRADE_PROGRAM_IS || op === OP.TRADE_LISTS || op === OP.MEMO_IS) st.push({ k: "tx", op: (Object.keys(TX_OP) as TxOp[]).find((k) => TX_OP[k] === op)!, key: keys[code[pc++]], col: 0 });
      else if (op === OP.REFUSE_IF || op === OP.REQUIRE) {
        const tree = st.pop();
        if (!tree || st.length) return null;
        // a bare 0/1 tree is a constant rule: show it as a comparison so it stays a condition
        const cond = flex(tree) === "bool" ? tree : ({ k: "bin", op: "!=", l: tree, r: num(B(0)), col: 0 } as Node);
        needBool(cond, decimals);
        const kind = op === OP.REFUSE_IF ? "refuse" : "require";
        const text = `${kind === "refuse" ? "refuse if" : "require"} ${source(cond, decimals)}`;
        const w = words(cond, decimals);
        // a game-only rule set carries one rule that never refuses: not worth showing
        if ((king || emptyOk) && tree.k === "num" && tree.raw === B(0) && kind === "refuse") continue;
        lines.push(text);
        rules.push({ line: lines.length, source: text, kind, explain: kind === "refuse" ? `Refuses the transfer when ${w}.` : `Only allows the transfer when ${w}.` });
      } else {
        const name = BY_OP[op], r = st.pop(), l = st.pop();
        if (!name || !l || !r) return null;
        st.push({ k: "bin", op: name, l, r, col: 0 });
      }
    }
    if (st.length || (!rules.length && !king && !emptyOk) || keys.some((k) => !k)) return null;
    return { source: lines.join("\n"), rules };
  } catch { return null; } finally { lenient = false; }
}
