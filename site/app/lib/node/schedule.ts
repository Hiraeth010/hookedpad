import "../bufferShim";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

// Client for the Trading hours hook (the on-chain `schedule` program): the token trades
// only during the days and hours its creator set, in any time zone. The zone is stored on-chain
// as a yearly daylight-saving rule (POSIX style), derived here from the IANA zone with the
// browser's own clock data and checked against its real clock changes for the next six years.
// The open/closed logic below mirrors the Rust exactly, so the site can say when a token opens.

export const SCHEDULE_PROGRAM = new PublicKey("BUwCiwrRfVgNKEhHryBb626oKCRqNfm5hhkebrXKG6iY");

/** daylight time switches on the first `weekday` on or after day `fromDay` of `month` (0 = the last one), at a local
 *  minute that may run past either end of that day (−60 = 23:00 the evening before) */
export type DstRule = { month: number; fromDay: number; weekday: number; minute: number };
export type Schedule = {
  /** bit d = weekday d (0 = Sunday) trades */
  days: number;
  /** standard UTC offset, minutes east */
  stdOff: number;
  /** daylight-saving shift, minutes (0 = none) */
  dstShift: number;
  dstStart: DstRule;
  dstEnd: DstRule;
  /** [open, close) local minutes per weekday, Sunday first; open == close = all day, close < open = past midnight */
  windows: [number, number][];
};
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NO_RULE: DstRule = { month: 0, fromDay: 0, weekday: 0, minute: 0 };

export const schedulePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("hours"), mint.toBuffer()], SCHEDULE_PROGRAM)[0];
const eamlPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("extra-account-metas"), mint.toBuffer()], SCHEDULE_PROGRAM)[0];

function scheduleBytes(s: Schedule): Buffer {
  const b = Buffer.alloc(43);
  b[0] = s.days;
  b.writeInt16LE(s.stdOff, 1);
  b.writeInt16LE(s.dstShift, 3);
  for (const [at, r] of [[5, s.dstStart], [10, s.dstEnd]] as const) { b[at] = r.month; b[at + 1] = r.fromDay; b[at + 2] = r.weekday; b.writeInt16LE(r.minute, at + 3); }
  s.windows.forEach(([o, c], i) => { b.writeUInt16LE(o, 15 + 4 * i); b.writeUInt16LE(c, 17 + 4 * i); });
  return b;
}
function readSchedule(b: Buffer): Schedule {
  const rule = (at: number): DstRule => ({ month: b[at], fromDay: b[at + 1], weekday: b[at + 2], minute: b.readInt16LE(at + 3) });
  return {
    days: b[0], stdOff: b.readInt16LE(1), dstShift: b.readInt16LE(3), dstStart: rule(5), dstEnd: rule(10),
    windows: Array.from({ length: 7 }, (_, i) => [b.readUInt16LE(15 + 4 * i), b.readUInt16LE(17 + 4 * i)] as [number, number]),
  };
}

export function initializeScheduleIx(a: { payer: PublicKey; mint: PublicKey; pool: PublicKey; sellsOpen: boolean; schedule: Schedule; tz: string }): TransactionInstruction {
  const tz = Buffer.from(a.tz.slice(0, 40));
  const len = Buffer.alloc(4); len.writeUInt32LE(tz.length);
  return new TransactionInstruction({
    programId: SCHEDULE_PROGRAM,
    keys: [
      { pubkey: a.payer, isSigner: true, isWritable: true },
      { pubkey: eamlPda(a.mint), isSigner: false, isWritable: true },
      { pubkey: a.mint, isSigner: false, isWritable: false },
      { pubkey: schedulePda(a.mint), isSigner: false, isWritable: true },
      { pubkey: a.pool, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(sha256("global:initialize").slice(0, 8)), Buffer.from([a.sellsOpen ? 1 : 0]), scheduleBytes(a.schedule), len, tz]),
  });
}

/** cfg: magic "TRDHOURS" 8 | bump | creator @9 | sells_open @41 | schedule @42 (43 bytes) | tz len @85 | tz @86 */
export function decodeScheduleCfg(data: Buffer | Uint8Array): { creator: PublicKey; sellsOpen: boolean; schedule: Schedule; tz: string } | null {
  const d = Buffer.from(data);
  if (d.length < 126 || d.subarray(0, 8).toString() !== "TRDHOURS") return null;
  return { creator: new PublicKey(d.subarray(9, 41)), sellsOpen: d[41] === 1, schedule: readSchedule(d.subarray(42, 85)), tz: d.subarray(86, 86 + Math.min(40, d[85])).toString() };
}

// ---- calendar, mirroring the Rust ----

const DAY = 86_400;
const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;
function daysFromCivil(y: number, m: number, d: number): number {
  if (m <= 2) y -= 1;
  const era = floorDiv(y, 400), yoe = y - era * 400;
  const doy = floorDiv(153 * (m > 2 ? m - 3 : m + 9) + 2, 5) + d - 1;
  return era * 146_097 + yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy - 719_468;
}
function civilFromDays(z: number): [number, number, number] {
  z += 719_468;
  const era = floorDiv(z, 146_097), doe = z - era * 146_097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36_524) - floorDiv(doe, 146_096), 365);
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153), d = doy - floorDiv(153 * mp + 2, 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
const weekday = (days: number) => mod(days + 4, 7);
function ruleDay(r: DstRule, y: number): number {
  if (r.fromDay === 0) {
    const last = daysFromCivil(r.month === 12 ? y + 1 : y, r.month === 12 ? 1 : r.month + 1, 1) - 1;
    return last - mod(weekday(last) - r.weekday, 7);
  }
  const from = daysFromCivil(y, r.month, r.fromDay);
  return from + mod(r.weekday - weekday(from), 7);
}

/** The zone's UTC offset in seconds at unix time `ts`, per the on-chain rule. */
export function offsetAt(s: Schedule, ts: number): number {
  const std = s.stdOff * 60;
  if (!s.dstShift) return std;
  const shift = s.dstShift * 60, localStd = ts + std;
  const y = civilFromDays(floorDiv(localStd, DAY))[0];
  const start = ruleDay(s.dstStart, y) * DAY + s.dstStart.minute * 60;
  const end = ruleDay(s.dstEnd, y) * DAY + s.dstEnd.minute * 60 - shift;
  const dst = start < end ? localStd >= start && localStd < end : localStd >= start || localStd < end;
  return std + (dst ? shift : 0);
}
/** Is trading open at unix time `ts`? */
export function openAt(s: Schedule, ts: number): boolean {
  const local = ts + offsetAt(s, ts);
  const wd = weekday(floorDiv(local, DAY)), m = floorDiv(mod(local, DAY), 60);
  const on = (d: number) => (s.days & (1 << d)) !== 0;
  const [o, c] = s.windows[wd];
  if (on(wd) && (o === c || (o < c && m >= o && m < c) || (c < o && m >= o))) return true;
  const p = (wd + 6) % 7, [po, pc] = s.windows[p];
  return on(p) && pc < po && m < pc;
}
/** When the open/closed state next flips (unix seconds), or null if it never does within 8 days. */
export function nextChange(s: Schedule, ts: number): number | null {
  const now = openAt(s, ts);
  let t = ts - mod(ts, 60) + 60;
  for (let i = 0; i < 8 * 1440; i++, t += 60) if (openAt(s, t) !== now) return t;
  return null;
}

// ---- time zones: IANA name → on-chain rule ----

const fmts = new Map<string, Intl.DateTimeFormat>();
/** The zone's real UTC offset in minutes at unix time `ts`, from the browser's (or Node's) clock data. */
export function zoneOffsetMin(tz: string, ts: number): number {
  let f = fmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }); fmts.set(tz, f); }
  const name = f.formatToParts(new Date(ts * 1000)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
export function allTimeZones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
}
export const fmtOffset = (min: number) => `UTC${min < 0 ? "−" : "+"}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, "0")}` : ""}`;

/** Every clock change of `tz` between two unix times, to the minute. */
function transitions(tz: string, from: number, to: number): { at: number; before: number; after: number }[] {
  const out: { at: number; before: number; after: number }[] = [];
  const step = 6 * 3600;
  let prev = zoneOffsetMin(tz, from);
  for (let t = from + step; t <= to; t += step) {
    const cur = zoneOffsetMin(tz, t);
    if (cur === prev) continue;
    let lo = t - step, hi = t; // offset(lo) == prev, offset(hi) == cur
    while (hi - lo > 60) { const mid = lo + floorDiv((hi - lo) / 60, 2) * 60; if (zoneOffsetMin(tz, mid) === prev) lo = mid; else hi = mid; }
    out.push({ at: hi, before: prev, after: cur });
    prev = cur;
  }
  return out;
}

export type ZoneRule = Pick<Schedule, "stdOff" | "dstShift" | "dstStart" | "dstEnd"> & {
  /** false when the zone's clock changes don't follow a fixed yearly rule: stored at today's offset, all year */
  exact: boolean;
  /** human summary, e.g. "UTC−5, UTC−4 in daylight time" */
  label: string;
};

/** Turns an IANA zone into the hook's yearly rule, checked against the zone's real clock changes for six years. */
export function zoneRule(tz: string, now = Math.floor(Date.now() / 1000)): ZoneRule {
  const y0 = civilFromDays(floorDiv(now, DAY))[0];
  const from = daysFromCivil(y0, 1, 1) * DAY, to = daysFromCivil(y0 + 6, 1, 1) * DAY;
  const tr = transitions(tz, from, to);
  const fixed = (off: number, exact: boolean): ZoneRule => ({ stdOff: off, dstShift: 0, dstStart: NO_RULE, dstEnd: NO_RULE, exact, label: fmtOffset(off) });
  if (!tr.length) return fixed(zoneOffsetMin(tz, now), true);
  const offs = [...new Set(tr.flatMap((t) => [t.before, t.after]))];
  if (offs.length !== 2) return fixed(zoneOffsetMin(tz, now), false);
  const std = Math.min(...offs), shift = Math.max(...offs) - std;
  // candidate rules from the first year's two changes (as that day, or the day before or after with
  // the minute running past midnight), each "on or after day D" for every D that fits, or "the last"
  const firstYear = tr.filter((t) => civilFromDays(floorDiv(t.at + std * 60, DAY))[0] === y0);
  const into = firstYear.find((t) => t.after > t.before), out = firstYear.find((t) => t.after < t.before);
  if (!into || !out) return fixed(zoneOffsetMin(tz, now), false);
  const options = (localTs: number): DstRule[] => {
    const opts: DstRule[] = [];
    for (const shiftDays of [0, -1, 1]) {
      const days = floorDiv(localTs, DAY) + shiftDays, [y, m, d] = civilFromDays(days);
      const monthLen = daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);
      const base = { month: m, weekday: weekday(days), minute: floorDiv(mod(localTs, DAY), 60) - shiftDays * 1440 };
      // nicest first: the n-th weekday (D = 1, 8, 15, 22), the last one, then any other D
      const ds = [...new Set([7 * (Math.ceil(d / 7) - 1) + 1, ...(d + 7 > monthLen ? [0] : []), ...Array.from({ length: 7 }, (_, k) => d - k).filter((x) => x >= 1)])];
      for (const fromDay of ds) opts.push({ ...base, fromDay });
    }
    return opts;
  };
  const samples = Array.from({ length: 6 * 73 }, (_, i) => from + i * 5 * DAY + 3600 * (i % 24)).map((t) => [t, zoneOffsetMin(tz, t) * 60]);
  for (const s of options(into.at + std * 60)) {
    for (const e of options(out.at + (std + shift) * 60)) {
      const cand: Schedule = { days: 0, stdOff: std, dstShift: shift, dstStart: s, dstEnd: e, windows: [] };
      const ok = tr.every((t) => offsetAt(cand, t.at - 60) === t.before * 60 && offsetAt(cand, t.at) === t.after * 60)
        && samples.every(([t, off]) => offsetAt(cand, t) === off);
      if (ok) return { stdOff: std, dstShift: shift, dstStart: s, dstEnd: e, exact: true, label: `${fmtOffset(std)}, ${fmtOffset(std + shift)} in daylight time` };
    }
  }
  return fixed(zoneOffsetMin(tz, now), false);
}

// ---- launcher params: params.tz (IANA name) and params.hours ("1:540-1020;2:540-1020…") ----

export type DayHours = { on: boolean; open: number; close: number };
export const DEFAULT_HOURS = "1:540-1020;2:540-1020;3:540-1020;4:540-1020;5:540-1020";
export function parseHours(v: unknown): DayHours[] {
  const days: DayHours[] = Array.from({ length: 7 }, () => ({ on: false, open: 540, close: 1020 }));
  for (const part of String(v ?? DEFAULT_HOURS).split(";")) {
    const m = /^([0-6]):(\d{1,4})-(\d{1,4})$/.exec(part.trim());
    if (m) days[Number(m[1])] = { on: true, open: Math.min(1439, Number(m[2])), close: Math.min(1440, Number(m[3])) };
  }
  return days;
}
export const formatHours = (days: DayHours[]) => days.map((d, i) => (d.on ? `${i}:${d.open}-${d.close}` : "")).filter(Boolean).join(";");

export function scheduleFromParams(p: Record<string, number | string>): { schedule: Schedule; tz: string; zone: ZoneRule } {
  const tz = String(p.tz || "UTC");
  const zone = zoneRule(tz);
  const days = parseHours(p.hours);
  return {
    tz, zone,
    schedule: { days: days.reduce((m, d, i) => (d.on ? m | (1 << i) : m), 0), stdOff: zone.stdOff, dstShift: zone.dstShift, dstStart: zone.dstStart, dstEnd: zone.dstEnd, windows: days.map((d) => [d.open, d.close]) },
  };
}

export const clock = (min: number) => {
  const h = floorDiv(min, 60) % 24, m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};
const windowText = (o: number, c: number) => (o === c ? "all day" : `${clock(o)}–${c === 1440 ? "midnight" : clock(c)}${c < o ? " (next day)" : ""}`);
/** "Monday to Friday 9am–5pm" style summary of the days and windows. */
export function describeHours(days: DayHours[]): string {
  const groups: { from: number; to: number; text: string }[] = [];
  days.forEach((d, i) => {
    if (!d.on) return;
    const text = windowText(d.open, d.close), last = groups[groups.length - 1];
    if (last && last.to === i - 1 && last.text === text) last.to = i; else groups.push({ from: i, to: i, text });
  });
  if (!groups.length) return "never";
  return groups.map((g) => `${g.from === g.to ? DAY_NAMES[g.from] : `${DAY_NAMES[g.from]} to ${DAY_NAMES[g.to]}`} ${g.text}`).join(", ");
}
export const daysFromSchedule = (s: Schedule): DayHours[] => s.windows.map(([open, close], i) => ({ on: (s.days & (1 << i)) !== 0, open, close }));
