// The rules engine's instruction set and signals, shared by the compiler, the simulator and the
// decompiler. Mirrors the on-chain `rules` program exactly: change both.

export const OP = {
  PUSH0: 0x01, PUSH1: 0x02, PUSH_U8: 0x03, PUSH_U16: 0x04, PUSH_U32: 0x05, PUSH_U64: 0x06, PCT: 0x07,
  LOAD: 0x10,
  ADD: 0x20, SUB: 0x21, MUL: 0x22, DIV: 0x23, MOD: 0x24, NEG: 0x25, MIN: 0x26, MAX: 0x27,
  LT: 0x30, GT: 0x31, LE: 0x32, GE: 0x33, EQ: 0x34, NE: 0x35,
  AND: 0x40, OR: 0x41, NOT: 0x42,
  KEY_IS: 0x50, KEY_IN: 0x51, SIGNED_BY: 0x52, USES_PROGRAM: 0x53, TRADE_PROGRAM_IS: 0x54, TRADE_LISTS: 0x55, MEMO_IS: 0x56,
  REFUSE_IF: 0x60, REQUIRE: 0x61,
} as const;

export const F_STATE = 1, F_POOL = 2, F_IXS = 4, F_HIST = 8, F_KING = 16;
/** A token whose rules can change is given every optional account at launch, so any later rule set
 *  runs with the account list the token was created with. */
export const EDIT_FLAGS = F_STATE | F_POOL | F_IXS | F_HIST;
export const MAX_CODE = 4096, MAX_KEYS = 64, MAX_RULES = 64, MAX_STACK = 32, MAX_HIST = 100_000, MIN_HIST = 1000;
export const DEFAULT_HIST = 1000;
/** The history table's size in bytes for `cap` remembered wallets, mirroring programs/rules
 *  (`table_size`): up to 4,096 wallets it is one list (a one-byte fingerprint and a 24-byte entry
 *  each); above that it is hashed into buckets of 8 with 12.5% spare slots and an overflow ring. */
export const MAX_LIST = 4096;
export function histBytes(cap: number): number {
  if (cap <= MAX_LIST) return 32 + ((cap + 7) & ~7) + 24 * cap;
  const buckets = Math.floor((cap + Math.floor(cap / 8) + 7) / 8), overflow = Math.min(2048, Math.max(1024, Math.floor(cap / 8)));
  return 48 + 24 * (buckets * 8 + overflow);
}
/** about what that costs in rent at launch, in SOL */
export const histRentSol = (cap: number) => (histBytes(cap) + 128) * 0.00000508;
/** rule n (1-based) refuses a transfer with custom program error RULE_ERROR + n */
export const RULE_ERROR = 10_000;
/** "never happened", for the seconds-since signals */
export const NEVER = BigInt(1) << BigInt(62);

/** what a value measures: token amounts (raw units), SOL (lamports), seconds, a share (parts per million), a plain number, yes/no */
export type Ty = "amount" | "sol" | "time" | "ratio" | "num" | "bool";
export type Signal = { id: number; ty: Ty; flag: number; /** how it reads in a sentence */ phrase: string; doc: string; /** "huge" when it never happened */ never?: boolean };

const s = (id: number, ty: Ty, flag: number, phrase: string, doc: string, never = false): Signal => ({ id, ty, flag, phrase, doc, never });
export const SIGNALS: Record<string, Signal> = {
  amount: s(0, "amount", 0, "the amount", "tokens moved by this transfer"),
  sender_balance: s(1, "amount", 0, "the sender's balance afterwards", "sender's balance after the transfer"),
  receiver_balance: s(2, "amount", 0, "the receiver's balance afterwards", "receiver's balance after the transfer"),
  supply: s(3, "amount", 0, "the total supply", "total supply right now"),
  is_buy: s(4, "bool", 0, "it's a buy", "the tokens come out of the pool"),
  is_sell: s(5, "bool", 0, "it's a sell", "the tokens go into the pool"),
  is_transfer: s(6, "bool", 0, "it's a wallet-to-wallet send", "a wallet-to-wallet send"),
  now: s(7, "num", 0, "the unix time", "unix time"),
  launched_at: s(8, "num", 0, "the launch time", "unix time the rules were switched on"),
  seconds_since_launch: s(9, "time", 0, "the time since launch", "time since the rules were switched on"),
  slot: s(10, "num", 0, "the slot", "current slot"),
  minute: s(11, "num", 0, "the minute of the day", "minutes since midnight, in the rule set's time zone (UTC unless a timezone line sets one)"),
  hour: s(12, "num", 0, "the hour", "hour of the day (0-23), in the rule set's time zone"),
  weekday: s(13, "num", 0, "the weekday", "day of the week in the rule set's time zone: mon, tue, wed, thu, fri, sat, sun (0-6)"),
  day_of_month: s(14, "num", 0, "the day of the month", "day of the month (1-31), in the rule set's time zone"),
  month: s(15, "num", 0, "the month", "month (1-12), in the rule set's time zone"),
  minute_utc: s(16, "num", 0, "the UTC minute of the day", "minutes since midnight UTC"),
  hour_utc: s(17, "num", 0, "the UTC hour", "hour of the day UTC"),
  weekday_utc: s(18, "num", 0, "the UTC weekday", "day of the week UTC (mon = 0 … sun = 6)"),
  sender_is_creator: s(19, "bool", 0, "the sender is the creator", "the sender is the token's creator"),
  receiver_is_creator: s(20, "bool", 0, "the receiver is the creator", "the receiver is the token's creator"),
  trader_is_creator: s(21, "bool", 0, "the trader is the creator", "the trader (buyer on a buy, seller on a sell, sender on a send) is the creator"),
  trader_balance: s(22, "amount", 0, "the trader's balance afterwards", "the trader's balance after the transfer"),
  us_market_holiday: s(23, "bool", 0, "it's a US stock-market holiday", "today (New York date) is a NYSE full-day holiday such as Thanksgiving or Christmas"),
  market_cap: s(24, "sol", F_POOL, "the market cap", "market cap in SOL, from the pool's price"),
  curve_progress: s(25, "ratio", F_POOL, "the curve's progress", "how far the bonding curve is towards graduating"),
  pool_sol: s(26, "sol", F_POOL, "the SOL in the pool", "SOL raised in the pool so far"),
  buy_value: s(27, "sol", F_POOL, "what the buy is worth", "what this buy's tokens are worth in SOL at the pool's price (0 unless it's a buy)"),
  holders: s(30, "num", F_STATE, "the number of holders", "accounts holding the token (before this transfer)"),
  total_buys: s(31, "num", F_STATE, "the number of buys so far", "buys so far"),
  total_sells: s(32, "num", F_STATE, "the number of sells so far", "sells so far"),
  trades_this_slot: s(33, "num", F_STATE, "the trades already in this slot", "trades already made in the current slot"),
  buys_this_slot: s(34, "num", F_STATE, "the buys already in this slot", "buys already made in the current slot"),
  seconds_since_last_trade: s(35, "time", F_STATE, "the time since the last trade", "time since anyone last traded", true),
  seconds_since_last_buy: s(36, "time", F_STATE, "the time since the last buy", "time since anyone last bought", true),
  last_trade_was_buy: s(37, "bool", F_STATE, "the last trade was a buy", "the previous trade was a buy"),
  sender_is_last_buyer: s(38, "bool", F_STATE, "the sender is the latest buyer", "the sender is the most recent buyer"),
  receiver_is_last_buyer: s(39, "bool", F_STATE, "the receiver is the latest buyer", "the receiver is the most recent buyer"),
  trader_is_last_buyer: s(40, "bool", F_STATE, "the trader is the latest buyer", "the trader is the most recent buyer"),
  volume_bought: s(41, "amount", F_STATE, "the tokens bought so far", "tokens bought from the pool since launch, all buys added up"),
  volume_sold: s(42, "amount", F_STATE, "the tokens sold so far", "tokens sold into the pool since launch"),
  volume: s(43, "amount", F_STATE, "the tokens traded so far", "tokens bought plus tokens sold since launch"),
  priority_fee: s(44, "sol", F_IXS, "the priority fee", "priority fee this transaction pays"),
  jito_tip: s(45, "sol", F_IXS, "the Jito tip", "Jito tip this transaction pays"),
  sender_seconds_since_buy: s(48, "time", F_HIST, "the time since the sender last bought", "time since the sender's last buy", true),
  sender_seconds_since_sell: s(49, "time", F_HIST, "the time since the sender last sold", "time since the sender's last sell", true),
  receiver_seconds_since_buy: s(50, "time", F_HIST, "the time since the receiver last bought", "time since the receiver's last buy", true),
  receiver_seconds_since_sell: s(51, "time", F_HIST, "the time since the receiver last sold", "time since the receiver's last sell", true),
  sender_buys: s(52, "num", F_HIST, "the sender's number of buys", "how many times the sender has bought"),
  sender_sells: s(53, "num", F_HIST, "the sender's number of sells", "how many times the sender has sold"),
  receiver_buys: s(54, "num", F_HIST, "the receiver's number of buys", "how many times the receiver has bought"),
  receiver_sells: s(55, "num", F_HIST, "the receiver's number of sells", "how many times the receiver has sold"),
  sender_seconds_held: s(56, "time", F_HIST, "the time since the sender first bought", "time since the sender's first buy (0 if never)"),
  receiver_seconds_held: s(57, "time", F_HIST, "the time since the receiver first bought", "time since the receiver's first buy (0 if never)"),
  sender_is_king: s(58, "bool", F_KING, "the sender is the King", "the sender holds the King of the Hill crown"),
  receiver_is_king: s(59, "bool", F_KING, "the receiver is the King", "the receiver holds the crown"),
  trader_is_king: s(60, "bool", F_KING, "the trader is the King", "the trader holds the crown"),
  king_bid: s(61, "sol", F_KING, "the King's winning buy", "the King's winning buy in SOL (0 while the throne is empty)"),
  king_bar: s(62, "sol", F_KING, "the bar to take the crown", "what a buy has to beat right now to take the crown"),
  king_reign: s(63, "time", F_KING, "the King's reign so far", "how long the current King has held the crown"),
};
export const SIGNAL_BY_ID: Record<number, string> = Object.fromEntries(Object.entries(SIGNALS).map(([n, v]) => [v.id, n]));

/** the parties a rule can name: `sender is <wallet>`, `receiver in [<wallet>, …]` */
export const WHO: Record<string, number> = { sender: 0, receiver: 1, trader: 2, signer: 3 };
export const WHO_NAME = ["sender", "receiver", "trader", "signer"];
export const WHO_PHRASE = ["the sender", "the receiver", "the trader", "the signer"];
/** `sender is creator` and `trader is last_buyer` are sugar for these signals */
export const WHO_SPECIAL: Record<string, Record<string, string>> = {
  creator: { sender: "sender_is_creator", receiver: "receiver_is_creator", trader: "trader_is_creator" },
  last_buyer: { sender: "sender_is_last_buyer", receiver: "receiver_is_last_buyer", trader: "trader_is_last_buyer" },
  king: { sender: "sender_is_king", receiver: "receiver_is_king", trader: "trader_is_king" },
};
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** well-known wallets and programs a rule can name instead of pasting the address */
export const NAMED_KEYS: Record<string, { address: string; what: string }> = {
  fomo: { address: "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51", what: "FOMO" }, // FOMO_COSIGNER (cosign.ts)
  opensea: { address: "SeaPaYBfKuAG9S4FqNpcLAuMqhHkyd5kxC73eovFBNA", what: "OpenSea" },
  jupiter: { address: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", what: "Jupiter" },
  okx_router: { address: "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u", what: "the OKX router" },
  jupiter_app_tag: { address: "jitodontfront1111111111111111JustUseJupiter", what: "Jupiter's app tag" },
};

/** The King of the Hill game's settings when a rule set switches it on (the `king_of_the_hill` line). */
export type KingGame = { minBuySol: number; stepPct: number; halfLifeSec: number; creatorCanRule: boolean };
/** these tokens trade with a 1.65% pool fee, 38% of it (after Meteora's cut) to the King: see node/king.ts */
export const KING_POOL_FEE = { bps: 165, creatorPct: 38 };
/** the memo every OpenSea swap carries */
export const OPENSEA_MEMO = "865d8597";
