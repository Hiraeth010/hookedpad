import { SIGNALS, NAMED_KEYS, MAX_CODE, MAX_KEYS, MAX_RULES, DEFAULT_HIST, MAX_HIST, F_HIST, F_IXS, F_POOL, F_STATE, type Ty } from "./spec";

// The rule language in words: the reference the on-site hook builder's AI works from, and the
// source of the signal list the docs and API show. Generated from the same tables the compiler
// uses, so it can't drift from what actually compiles.

const TY_NOTE: Record<Ty, string> = {
  amount: "token amount", sol: "SOL", time: "length of time", ratio: "percentage", num: "number", bool: "yes/no",
};
const NEEDS: Record<number, string> = { 0: "", [F_POOL]: "pool", [F_STATE]: "counters", [F_IXS]: "transaction", [F_HIST]: "wallet history" };

export const signalTable = () => Object.entries(SIGNALS).map(([name, s]) => ({ name, type: TY_NOTE[s.ty], needs: NEEDS[s.flag], doc: s.doc + (s.never ? " (huge if it never happened)" : "") }));

export function languageReference(): string {
  const sigs = signalTable().map((s) => `- ${s.name} (${s.type}): ${s.doc}`).join("\n");
  return `A rule set is plain text, one rule per line. The hook runs every rule, top to bottom, on every buy, sell and wallet-to-wallet send of the token. If any rule says no, the whole transaction fails.

Lines:
- refuse if <condition>      the transfer fails when the condition is true
- require <condition>        the transfer fails when the condition is false
- timezone <IANA name>       optional, at most once (e.g. timezone America/New_York). It makes hour, minute, weekday, day_of_month and month local to that zone, daylight saving included. Without it they are UTC.
- king_of_the_hill min 0.1 SOL step 5% halves 6h creator no     optional, at most once: switches the King of the Hill game on (see below). Every part after the name is optional.
- # starts a comment

Conditions:
- and, or, not, ( )
- < > <= >= == !=
- + - * / mod, min(a, b), max(a, b)
- sender is <address>, receiver is not <address>, trader in [<address>, <address>]   (parties: sender, receiver, trader, signer)
- sender is creator, trader is creator, trader is last_buyer
- signed_by <address>        some instruction of the transaction is signed by that wallet (how an app's own trades are recognised)
- uses_program <address>     the transaction calls that program
- trade_program is <address>   the instruction running this trade belongs to that program (stricter than uses_program)
- trade_lists <address>      the instruction running this trade lists that account
- memo is "text"             the transaction has a memo with exactly that text
- via_fomo, via_pump_app, via_opensea     the trade was made in that app (see the recipes below)
- sender is king, trader is king          the wallet holds the King of the Hill crown (only with the game on)
- known names usable in place of an address: ${Object.entries(NAMED_KEYS).map(([k, v]) => `${k} (${v.what})`).join(", ")}

Parties: the sender is the wallet the tokens leave, the receiver is the wallet they arrive in. On a buy the tokens leave the pool, so the buyer is the receiver; on a sell the seller is the sender. "trader" is the buyer on a buy, the seller on a sell, and the sender on a send, so it is usually the one to use.

Values have units and the compiler refuses mismatches:
- token amounts: 1% (a percent next to a token amount is a share of total supply), 5000 tokens, or a bare number (whole tokens)
- SOL: 0.5 SOL
- time: 90s, 15m, 2h, 3d, 1w, "15 minutes", or a bare number (seconds)
- percentages (only curve_progress): 50%
- weekdays: mon tue wed thu fri sat sun (mon = 0 … sun = 6)
- yes/no signals are used directly: "is_buy and not trader_is_creator"

Signals:
${sigs}

Balances are the balance AFTER the transfer. So on a buy, receiver_balance is what the buyer ends up holding; on a sell, sender_balance + amount is what the seller held before.

King of the Hill (the game):
- Add the line king_of_the_hill to run the game alongside any rules. The largest qualifying buy holds the crown; another wallet takes it with a single buy that beats the bar by the step. The bar is the King's winning buy, halving every "halves" period, never below "min". Any sell or send by the King gives the crown up. "creator yes" lets the launcher's own wallet be King.
- While King, a wallet earns about 0.5% of every trade, paid in SOL by the program. Tokens with the game trade with a 1.65% fee instead of 1%. Always tell the creator about the fee, and suggest the Permanent curve because the game ends when a token graduates.
- With the game on, rules can use trader_is_king / sender_is_king / receiver_is_king, king_bid, king_bar and king_reign. Do not write a rule that stops the King from selling unless the creator asks for exactly that: it would trap the King.
- A rule set can be the game alone (just the king_of_the_hill line) or the game plus rules.

Things to know:
- Nothing is exempt automatically. The creator's own first buy at launch goes through the rules too, so a buy cap usually wants "and not trader is creator".
- Rules apply to sells as well. A rule set that can refuse every sell traps holders; say so plainly if a rule set could do that.
- Wallet-history signals (the sender_… and receiver_… times and counts) come from one shared table that remembers the most recent traders (${DEFAULT_HIST.toLocaleString("en-US")} by default; the creator can raise it up to ${MAX_HIST.toLocaleString("en-US")} with the "Wallets remembered" slider, which costs more rent at launch); when it is full an old, inactive wallet is forgotten, and a forgotten wallet reads as "never traded". A send carries the sender's buy times to the receiver, so a cooldown can't be dodged by moving tokens to a fresh wallet.
- trades_this_slot and buys_this_slot count trades already made in the current slot (about 0.4 seconds), which is how bundles are limited.
- market_cap, curve_progress and pool_sol are read from the token's bonding-curve pool. After the token graduates from the curve, Meteora removes the hook, so rules only apply while it is on the curve.
- Every rule set trades on any DEX or aggregator; nothing needs a special route.
- trades_this_slot aside, volume_bought / volume_sold / volume add up every trade since launch, in tokens.
- via_pump_app is the weakest of the app checks: it recognises the tag Jupiter writes for app trades, which another app using the same Jupiter service would also carry. via_fomo and the signature half of via_opensea can't be faked.
- Limits: ${MAX_RULES} rules, ${MAX_CODE.toLocaleString("en-US")} bytes of compiled code, ${MAX_KEYS} named wallets. Rules are fixed at launch and can never change.

Hooked's own hooks as rules. Each of these is also a ready-made rule in the launcher; here they can be mixed freely.
- Trade guard (max per trade):        refuse if (is_buy or is_sell) and amount > 1% and not trader is creator
- Max per wallet:                      refuse if not is_sell and receiver_balance > 2% and not receiver is creator
- Anti-dump caps:                      refuse if is_buy and amount > 2% and not trader is creator   +   refuse if is_sell and amount > 0.5%
- Graduated sell caps:                 refuse if is_sell and amount > max(0.1%, 1% - (sender_balance + amount) / 4)      # bigger bags sell smaller pieces
- Sliding caps (by market cap):        refuse if is_buy and market_cap < 500 SOL and amount > 0.5% and not trader is creator
- Rising max per wallet (on a timer):  refuse if not is_sell and receiver_balance > min(2%, 0.1% + seconds_since_launch / 5m * 0.1%) and not receiver is creator
- Chapters (cap doubles with volume):  refuse if not is_sell and receiver_balance > 0.5% and volume < 10000000 tokens and not receiver is creator   +   refuse if not is_sell and receiver_balance > 1% and volume < 20000000 tokens and not receiver is creator      # one line per chapter: each doubles the cap until that much volume has traded
- Anti-bundle:                         refuse if is_buy and buys_this_slot >= 3
- Sniper-fee cap:                      refuse if is_buy and seconds_since_launch < 10m and (priority_fee > 0.002 SOL or jito_tip > 0.002 SOL) and not trader is creator
- Conviction cap:                      refuse if is_buy and not trader is creator and amount > min(0.1% + min(receiver_seconds_held, receiver_seconds_since_sell) / 1d * 0.1%, 2%)
- Hot potato:                          refuse if not is_buy and sender is last_buyer
- Ping Pong:                           refuse if is_buy and last_trade_was_buy and total_buys > 0   +   refuse if is_sell and not last_trade_was_buy
- Blocklist:                           refuse if receiver in [<address>, <address>]
- Allowlist (up to ${MAX_KEYS} wallets):        require is_sell or receiver in [<address>, <address>] or receiver is creator
- DEX-only / Venue-locked:             refuse if is_transfer
- P2P-only:                            refuse if (is_buy or is_sell) and not trader is creator
- FOMO-only buys:                      refuse if is_buy and not via_fomo and not trader is creator
- Pump App only:                       refuse if is_buy and not via_pump_app and not trader is creator
- Social trading (FOMO or Pump, buys and sells):  refuse if (is_buy or is_sell) and not via_fomo and not via_pump_app and not trader is creator
- OpenSea only:                        refuse if (is_buy or is_sell) and not via_opensea and not trader is creator
- Market hours (NYSE session):         timezone America/New_York   +   require is_transfer or (weekday < sat and minute >= 570 and hour < 16 and not us_market_holiday)
- Trading hours (any zone):            timezone <zone>   +   require is_transfer or (<days and hours>)
- King of the Hill:                    king_of_the_hill min 0.1 SOL step 5% halves 6h
Warn the creator when an app-only rule also blocks sells (Social trading, OpenSea only): holders can then only exit inside that app.

These Hooked hooks can NOT be written as rules, because they do more than allow or refuse. If asked, say so and tell the creator to pick that rule in the launcher instead (it can't be mixed with custom rules):
- Pegs (numbered objects with art), the Physics tokens (Breathing cap, Momentum, Resonance, Coupled resonator), Buyer rewards, Dividends and Tithe (they pay out), Holder vesting (it tracks how much of each wallet's bag is unlocked), Holder-gated (it reads the buyer's balance of another token), Reactive pair and Entangled / Beacon (they read another token).
- A vesting-like effect that IS possible (no selling in a wallet's first week):
refuse if is_sell and sender_seconds_held < 7d

Examples:
refuse if is_buy and amount > 1% and not trader is creator            # max 1% of supply per buy
refuse if not is_sell and receiver_balance > 2% and not receiver is creator   # max 2% per wallet
refuse if is_sell and sender_seconds_since_buy < 15m                  # wait 15 minutes after buying before selling
refuse if is_sell and seconds_since_launch < 10m                      # no selling in the first 10 minutes
refuse if is_buy and buys_this_slot >= 3                              # at most 3 buys per slot (anti-bundle)
refuse if is_buy and priority_fee > 0.002 SOL                         # sniper-fee cap
refuse if is_buy and market_cap < 500 SOL and amount > 0.5% and not trader is creator   # small buys until 500 SOL market cap
refuse if is_sell and sender_balance + amount >= 3% and amount > 0.1% # whales sell slowly
refuse if is_buy and not trader is creator and amount > min(0.1% + min(receiver_seconds_held, receiver_seconds_since_sell) / 1d * 0.1%, 2%)   # conviction cap: a wallet's buy limit starts at 0.1%, grows 0.1% per day it holds without selling, up to 2%; selling resets it
refuse if is_sell and sender is last_buyer                            # hot potato: the latest buyer can't sell until someone buys after them
refuse if is_buy and not signed_by fomo and not trader is creator     # buys only through the FOMO app
timezone Asia/Tokyo
require is_transfer or (weekday < sat and hour >= 9 and hour < 17)    # trades only Mon-Fri 9am-5pm Tokyo time; sends always work`;
}
