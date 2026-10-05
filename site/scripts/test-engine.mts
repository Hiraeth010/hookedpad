// Offline checks of the rule language (app/lib/node/engine): compile, plain-English reading,
// errors, decompile round trip, and the simulator. No chain needed.
//   npx tsx scripts/test-engine.mts
import { compileRules, decompileRules, type Compiled } from "../app/lib/node/engine/lang.ts";
import { simulate, validateCode } from "../app/lib/node/engine/vm.ts";
import { F_HIST, F_IXS, F_POOL, F_STATE } from "../app/lib/node/engine/spec.ts";

let fails = 0;
const ok = (c: unknown, label: string) => { console.log(`  ${c ? "✓" : "✕"} ${label}`); if (!c) fails++; };
const TOKEN = { supply: 1_000_000_000, decimals: 9 };
const A = "DXFqi6tXYGjavSCXEV7NHGYwsaWMqSszrx6VKcg6yUNq", Bk = "HYhbPTEqHkpYZEidUYbP5jgG69NnphYGqNKXQS4Ndgiz", C = "8D71hCD9xnQbxEjUedH4dHHVXrJowG4bDVVjCtdDwFGz";
const must = (src: string): Compiled => { const c = compileRules(src, { decimals: 9 }); if (!c.ok) throw new Error(`${src}\n${JSON.stringify(c.errors)}`); return c; };
const refused = (c: Compiled, t: Record<string, number | string | boolean>, tx = {}) => { const r = simulate(c, t, TOKEN, tx); return r.ok ? 0 : r.refusedBy; };

const err = (src: string) => { const c = compileRules(src, { decimals: 9 }); return c.ok ? "" : `${c.errors[0].line}:${c.errors[0].col} ${c.errors[0].message}`; };
console.log("editable rule sets (Editable hook, DAO hook)");
{
  const e = (src: string) => compileRules(src, { decimals: 9, editable: true });
  const c = e("refuse if is_buy and amount > 1%");
  ok(c.ok && c.flags === 15 && c.histCap === 1000, "an editable rule set always asks for every optional account (flags 15) and a history table, whatever its rules use");
  const none = e("  # nothing yet\n");
  ok(none.ok && none.rules.length === 0 && none.bytes === 2 && refused(none as Compiled, { is_sell: 1, amount: "50%" }) === 0, "it may hold no rules at all: 2 bytes that never refuse");
  ok(!compileRules("", { decimals: 9 }).ok, "(a fixed rule set still needs at least one rule)");
  const k = e("king_of_the_hill\nrefuse if is_sell and sender is king");
  ok(!k.ok && /whose rules can change/.test(k.errors[0].message), `King of the Hill is refused: "${k.ok ? "" : k.errors[0].message}"`);
  const back = none.ok ? decompileRules(none.code, none.keys, none.tz, 9, null, true) : null;
  ok(back?.rules.length === 0 && back.source === "", "an empty rule set reads back from its bytecode as empty");
}
console.log("compile + simulate");
{
  const c = must("refuse if is_buy and amount > 1%");
  ok(c.bytes === 12 && c.flags === 0 && c.rules[0].explain === "Refuses the transfer when it's a buy and the amount is over 1% of supply.", `max buy 1%: ${c.bytes} bytes · "${c.rules[0].explain}"`);
  ok(refused(c, { is_buy: 1, amount: "1%" }) === 0 && refused(c, { is_buy: 1, amount: "2.5%" }) === 1 && refused(c, { is_sell: 1, amount: "50%" }) === 0, "a 1% buy passes, a 2.5% buy is refused by rule 1, sells are untouched");
}
{
  const c = must("refuse if not is_sell and receiver_balance > 2%");
  ok(refused(c, { is_buy: 1, receiver_balance: 20_000_001 }) === 1 && refused(c, { receiver_balance: 20_000_000 }) === 0, "max wallet 2% (whole-token numbers in the simulator)");
}
{
  const c = must("refuse if is_sell and seconds_since_launch < 10 minutes\nrefuse if is_sell and sender_seconds_since_buy < 900");
  ok(c.flags === F_HIST && c.histCap === 1000, "wallet-history rules ask for the shared history table (1,000 wallets by default)");
  ok(refused(c, { is_sell: 1, seconds_since_launch: "5m" }) === 1 && refused(c, { is_sell: 1, seconds_since_launch: "11m", sender_seconds_since_buy: 60 }) === 2 && refused(c, { is_sell: 1, seconds_since_launch: "11m" }) === 0, "no selling for 10 minutes, then a 15-minute cooldown after buying; never bought = no cooldown");
}
{
  const c = must("timezone America/New_York\nrequire weekday < sat\nrequire minute >= 570 and hour < 16");
  ok(c.tzName === "America/New_York" && c.tz[0] === 0xd4 && c.tz[1] === 0xfe && c.rules[0].explain === "Only allows the transfer when the weekday is under Saturday.", `local trading hours: tz bytes ${Buffer.from(c.tz).toString("hex")} · "${c.rules[0].explain}"`);
  ok(refused(c, { weekday: 5 }) === 1 && refused(c, { weekday: 2, minute: 569, hour: 9 }) === 2 && refused(c, { weekday: 2, minute: 600, hour: 10 }) === 0, "weekends refused by rule 1, before 9:30 by rule 2");
}
{
  const c = must("refuse if is_sell and sender_balance + amount >= 3% and amount > 0.1%");
  ok(refused(c, { is_sell: 1, sender_balance: "2.9%", amount: "0.2%" }) === 1 && refused(c, { is_sell: 1, sender_balance: "1%", amount: "0.5%" }) === 0, "whales sell slower");
}
{
  const c = must(`require is_sell or receiver in [${A}, ${Bk}]`);
  ok(c.keys.length === 2 && refused(c, { is_buy: 1, receiver: A }) === 0 && refused(c, { is_buy: 1, receiver: C }) === 1 && refused(c, { is_sell: 1, receiver: C }) === 0, "private allowlist");
}
{
  const c = must("refuse if is_buy and market_cap < 500 SOL and amount > 0.5% and not trader is creator\nrefuse if curve_progress > 90% and is_sell and amount > 0.25%");
  ok(c.flags === F_POOL, "market-cap rules ask for the pool only");
  ok(refused(c, { is_buy: 1, market_cap: 100, amount: "1%" }) === 1 && refused(c, { is_buy: 1, market_cap: 100, amount: "1%", trader_is_creator: 1 }) === 0 && refused(c, { is_buy: 1, market_cap: 600, amount: "1%" }) === 0 && refused(c, { is_sell: 1, curve_progress: "95%", amount: "0.3%" }) === 2, "small buys until 500 SOL market cap (creator exempt); small sells near graduation");
}
{
  const c = must("refuse if is_buy and not signed_by fomo\nrefuse if is_buy and priority_fee > 0.002 SOL\nrequire not uses_program jupiter or is_sell");
  ok(c.flags === F_IXS && c.keys.length === 2, "app and fee rules ask for the transaction's instructions");
  const fomo = c.keys[0], jup = c.keys[1];
  ok(refused(c, { is_buy: 1 }) === 1 && refused(c, { is_buy: 1, priority_fee: 0.01 }, { signers: [fomo] }) === 2 && refused(c, { is_buy: 1 }, { signers: [fomo], programs: [jup] }) === 3 && refused(c, { is_buy: 1 }, { signers: [fomo] }) === 0, "FOMO-signed buys only, sniper-fee cap, no Jupiter buys");
}
{
  const c = must("refuse if is_buy and buys_this_slot >= 3\nrefuse if is_sell and sender is last_buyer\nrefuse if is_buy and last_trade_was_buy and total_buys > 0\nrequire holders < 5000 or not is_buy");
  ok(c.flags === F_STATE, "counter rules make the rules account writable");
  ok(refused(c, { is_buy: 1, buys_this_slot: 3 }) === 1 && refused(c, { is_sell: 1, sender_is_last_buyer: 1 }) === 2 && refused(c, { is_buy: 1, last_trade_was_buy: 1, total_buys: 4 }) === 3 && refused(c, { is_buy: 1, holders: 5000 }) === 4, "anti-bundle, hot potato, ping pong and a holder cap, all as rules");
}
{
  const c = must("refuse if is_sell and sender_seconds_since_buy < 15 * 60\nrefuse if is_buy and amount > min(1%, 5_000_000 tokens) * 2\nrefuse if amount mod 1000 tokens != 0 tokens\nrequire (is_buy == 1) != (is_sell == 1) or is_transfer");
  ok(refused(c, { is_sell: 1, sender_seconds_since_buy: 899 }) === 1 && refused(c, { is_buy: 1, amount: 10_000_001 }) === 2 && refused(c, { is_buy: 1, amount: 1500 }) === 3 && refused(c, { is_buy: 1, amount: 2000 }) === 0, "arithmetic: 15 * 60 is seconds, min(), mod, brackets");
}

{
  const c = must("king_of_the_hill min 0.5 SOL step 10% halves 2h creator yes\nrefuse if is_sell and sender is king and king_reign < 10m\nrefuse if is_buy and buy_value > 5 SOL and buy_value < king_bar");
  ok(c.king?.minBuySol === 0.5 && c.king.stepPct === 10 && c.king.halfLifeSec === 7200 && c.king.creatorCanRule && (c.flags & 16) !== 0 && (c.flags & F_POOL) !== 0, "the king_of_the_hill line switches the game on with its settings, and asks for the pool");
  ok(refused(c, { is_sell: 1, sender_is_king: 1, king_reign: "5m" }) === 1 && refused(c, { is_sell: 1, sender_is_king: 1, king_reign: "11m" }) === 0 && refused(c, { is_buy: 1, buy_value: 6, king_bar: 8 }) === 2, "rules can use the game: the King can't sell in the first 10 minutes of a reign; big buys must take the crown");
  const only = must("king_of_the_hill");
  ok(only.rules.length === 0 && only.king?.minBuySol === 0.1 && only.bytes === 2, "a rule set can be the game alone");
  ok(err("refuse if is_sell and sender is king").includes("king_of_the_hill"), "using the King signals without the game is an error that says what to add");
}
{
  const c = must('refuse if is_buy and not via_fomo and not via_pump_app and not via_opensea');
  const [fomo, okx, tag, opensea] = [c.keys[0], c.keys[1], c.keys[2], c.keys[3]];
  ok(c.keys.length === 5 && refused(c, { is_buy: 1 }) === 1 && refused(c, { is_buy: 1 }, { signers: [fomo] }) === 0
    && refused(c, { is_buy: 1 }, { tradeProgram: okx, tradeAccounts: [tag] }) === 0 && refused(c, { is_buy: 1 }, { tradeProgram: okx, tradeAccounts: [tag], signers: [fomo] }) === 0
    && refused(c, { is_buy: 1 }, { tradeProgram: okx }) === 1 && refused(c, { is_buy: 1 }, { memos: ["865d8597"] }) === 0 && refused(c, { is_buy: 1 }, { signers: [opensea] }) === 0 && refused(c, { is_buy: 1 }, { memos: ["nope"] }) === 1,
    "app checks: FOMO's signature, the Pump app's router and tag, OpenSea's wallet or memo");
  const m = must('timezone America/New_York\nrequire is_transfer or (weekday < sat and minute >= 570 and hour < 16 and not us_market_holiday)\nrefuse if not is_sell and receiver_balance > 0.5% and volume < 10000000 tokens');
  ok(refused(m, { is_buy: 1, weekday: 2, minute: 600, hour: 10, us_market_holiday: 1 }) === 1 && refused(m, { is_buy: 1, weekday: 2, minute: 600, hour: 10, receiver_balance: "0.6%", volume: 5_000_000 }) === 2 && refused(m, { is_buy: 1, weekday: 2, minute: 600, hour: 10, receiver_balance: "0.6%", volume: 10_000_000 }) === 0,
    "market holidays close the market; a Chapters cap lifts once enough volume has traded");
}

console.log("errors");
for (const [src, want] of [
  ["refuse if amount > 5 SOL", "don't match"],
  ["refuse if amont > 1%", "Did you mean amount"],
  ["refuse if amount", "yes/no condition"],
  ["allow if is_buy", 'starts with "refuse if" or "require"'],
  ["refuse if is_buy and (amount > 1%", 'Expected ")"'],
  ["refuse if curve_progress > 50", "percentage"],
  ["refuse if amount > 0.0000000001 tokens", "too precise"],
  ["timezone Mars/Olympus\nrequire is_buy", "isn't a time zone"],
  ["require receiver is notanaddress", "wallet or program address"],
  ["", "at least one rule"],
] as const) { const e = err(src); ok(e.includes(want), `${JSON.stringify(src).slice(0, 50)} → ${e || "(compiled!)"}`); }

console.log("decompile round trip");
for (const src of [
  "refuse if is_buy and amount > 1%",
  "refuse if not is_sell and receiver_balance > 2%\nrefuse if is_sell and sender_seconds_since_buy < 15 minutes",
  "timezone Europe/London\nrequire weekday < sat and hour >= 9 and hour < 17",
  `require is_sell or receiver in [${A}, ${Bk}]\nrefuse if sender is ${C}\nrefuse if is_buy and not signed_by fomo`,
  "refuse if is_buy and market_cap < 500 SOL and amount > 0.5%\nrefuse if curve_progress > 90% and is_sell\nrefuse if priority_fee > 0.002 SOL or jito_tip > 0.01 SOL",
  "refuse if is_buy and amount > min(1%, 5000000 tokens) * 2\nrefuse if amount mod 1000 tokens != 0 tokens\nrequire (is_buy == 1) != (is_sell == 1) or is_transfer\nrefuse if -(amount - supply) < 5 tokens and not (is_buy or is_sell)",
  "refuse if is_buy and not trader is creator and amount > min(0.1% + min(receiver_seconds_held, receiver_seconds_since_sell) / 1d * 0.1%, 2%)\nrefuse if is_sell and seconds_since_launch / 1h < 2",
  "refuse if is_buy and buys_this_slot >= 3\nrefuse if is_sell and sender is last_buyer\nrequire holders < 5000 or not is_buy\nrefuse if seconds_since_last_buy > 2d and is_sell",
]) {
  const c = must(src);
  const d = decompileRules(c.code, c.keys, c.tz, 9);
  const again = d ? compileRules(d.source, { decimals: 9 }) : null;
  const same = !!again && again.ok && Buffer.from(again.code).equals(Buffer.from(c.code)) && again.keys.join() === c.keys.join() && Buffer.from(again.tz).equals(Buffer.from(c.tz));
  ok(same && validateCode(c.code, c.keys.length, c.flags) === c.rules.length, `${c.rules.length} rule(s), ${c.bytes} bytes ⇄ ${JSON.stringify(d?.source.split("\n")[d.source.startsWith("timezone") ? 1 : 0])}`);
}
ok(decompileRules(Uint8Array.from([0xee, 0x60]), [], new Uint8Array(14), 9) === null && validateCode(Uint8Array.from([0x02, 0x02, 0x60]), 0, 0) === null, "garbage bytecode is rejected");

console.log(`\n${fails ? `${fails} FAILED` : "ENGINE OK"}`);
process.exit(fails ? 1 : 0);
