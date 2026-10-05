import { PublicKey } from "@solana/web3.js";
import { DBC_POOL_AUTHORITY, DBC_PROGRAM, BASE_DECIMALS, IS_DEVNET } from "./env";
import { merkleRoot, parseAllowlist } from "./merkle";
import { parseHours, describeHours } from "./schedule";
import { DEFAULT_HIST, MAX_HIST, MIN_HIST, histRentSol } from "./engine/spec";

// The menu of "reactive node" behaviors. Each maps to a deployed Token-2022 transfer-hook
// program and to that program's exact `initialize` argument encoding. One
// initialize call creates BOTH the per-mint state PDA and the ExtraAccountMetaList, and
// must run AFTER the Meteora DBC pool creates the mint (mint_to doesn't fire hooks).

/** How many recent traders a rules-engine token remembers (the "Wallets remembered" setting). */
/** Editable and DAO hooks: how long a sealed change waits before it takes effect, in seconds. */
export const noticeSec = (p: Record<string, number | string>) => { const n = Math.round(Number(p.notice ?? 0)); return [0, 600, 3600, 86400].includes(n) ? n : 0; };
export const noticeWords = (p: Record<string, number | string>) => ({ 0: "no time", 600: "10 minutes", 3600: "1 hour", 86400: "24 hours" } as Record<number, string>)[noticeSec(p)];
/** DAO hook: tokens a wallet must hold to post or vote, and the net votes an idea needs. */
export const daoMinHold = (p: Record<string, number | string>) => Math.max(1, Math.min(100_000_000, Math.round(Number(p.minHold) || 1_000_000)));
export const daoVotes = (p: Record<string, number | string>) => Math.max(1, Math.min(100_000, Math.round(Number(p.votesToPass) || 25)));
export const histCapOf = (p: Record<string, number | string>) => Math.max(MIN_HIST, Math.min(MAX_HIST, Math.round(num(p.histCap, DEFAULT_HIST))));
/** Conviction cap's growth period: a minute, an hour or a day (tokens from before the choice have none: a day). */
const convictionUnit = (p: Record<string, number | string>) => (p.growthUnit === "minute" ? { word: "minute", lit: "1m" } : p.growthUnit === "hour" ? { word: "hour", lit: "1h" } : { word: "day", lit: "1d" });
/** Conviction cap as rule source: a wallet's buy cap starts at startCap and grows by growthPerDay for
 *  each full period (minute, hour or day) since it first bought or last sold (whichever is later), up to maxCap. */
export function convictionRules(p: Record<string, number | string>): string {
  const pct = (v: number) => `${+v.toFixed(4)}%`;
  const s = num(p.startCap, 0.1), g = num(p.growthPerDay, 0.1), m = Math.max(s, num(p.maxCap, 2));
  return `refuse if is_buy and not trader is creator and amount > min(${pct(s)} + min(receiver_seconds_held, receiver_seconds_since_sell) / ${convictionUnit(p).lit} * ${pct(g)}, ${pct(m)})`;
}

export type ParamType = "range" | "pct" | "pubkey" | "pubkeyList" | "numList" | "choice" | "levels";

export type Param = {
  key: string;
  label: string;
  /** text shown inside an empty address box (defaults by whether it wants a mint or a wallet) */
  placeholder?: string;
  help?: string;
  type: ParamType;
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
  unit?: string;
  // pubkey params that must be set or the token launches broken (e.g. a holder-gate mint).
  required?: boolean;
  /** "choice" params: the options, shown as buttons */
  options?: { value: string; label: string }[];
  /** hide this setting unless another setting has a given value */
  showIf?: { key: string; value: string };
  /** "pct" params: a typed number box instead of a slider, for values too fine to drag to */
  numeric?: boolean;
  /** "range" params: a typed amount box (with `unit` after it) instead of a slider */
  amount?: boolean;
};

export type PreviewKind = "breathing" | "momentum" | "coupled" | "reactive" | "inverse" | "gate" | "index" | "emission" | "ratchet" | "ratelimit";

// Typed on-chain arg for borsh encoding (order matters).
export type InitArg =
  | { t: "u8"; v: number }
  | { t: "u16"; v: number }
  | { t: "u32"; v: number }
  | { t: "u64"; v: bigint }
  | { t: "i64"; v: bigint }
  | { t: "pubkey"; v: PublicKey }
  | { t: "vec_pubkey"; v: PublicKey[] }
  | { t: "vec_u64"; v: bigint[] }
  | { t: "bytes32"; v: Uint8Array }; // fixed [u8;32], e.g. a merkle root — no length prefix

// Runtime addresses threaded into initialize for side-token behaviors (emit/distrib):
// the reward mint + vault (and optional stake mint/vault) are created by the pipeline
// just before init, so they can't live in the static param map.
export type InitCtx = { sideMint?: PublicKey; vault?: PublicKey; stakeMint?: PublicKey; stakeVault?: PublicKey; creator?: PublicKey; payoutTreasury?: PublicKey; cutoffSlot?: bigint };

// Behavior families for grouping the selector / learn page.
export type Family = "Caps" | "Dynamics" | "Emission" | "Rewards" | "Reactive" | "Guards";

// Vesting unlocks: a percentage per period, where the period is any whole number of hours.
// Slots are ~0.4 s, so one hour ≈ 9000 slots. Older saved launches used "unlockPerDay" (period 24h).
const SLOTS_PER_HOUR = 9000;
const unlockPct = (p: Record<string, number | string>) => num(p.unlockPct ?? p.unlockPerDay, 10);
const unlockHours = (p: Record<string, number | string>) => Math.max(1, Math.round(num(p.unlockEveryHours, 24)));
function vestingSummary(p: Record<string, number | string>, who: string): string {
  const pct = unlockPct(p), hrs = unlockHours(p), cliff = num(p.cliffHours, 24);
  const every = hrs === 1 ? "every hour" : hrs % 24 === 0 ? (hrs === 24 ? "every day" : `every ${hrs / 24} days`) : `every ${hrs} hours`;
  const periods = Math.ceil(100 / Math.max(0.01, pct));
  const total = cliff + (periods - 1) * hrs;
  const fmt = (h: number) => (h >= 48 ? `${+(h / 24).toFixed(1)} days` : `${+h.toFixed(1)} hours`);
  return `${who} unlock ${+pct.toFixed(2)}% ${every}, starting ${cliff ? `${fmt(cliff)} after their first buy` : "at their first buy"}. Fully unlocked after about ${fmt(total)}.`;
}

// Entangled unlocks: the Beacon counts every one of its tokens that changes hands (buys, sells
// and transfers). Every Hooked token has 1,000,000,000 supply, so a % maps to a fixed count.
export const HOOKED_SUPPLY = 1_000_000_000;
export const tokensForPct = (pct: number) => Math.round((pct / 100) * HOOKED_SUPPLY);
// drip rules (Holder vesting): each wallet's first buy opens a 73-byte slot whose rent (~0.0014
// SOL) comes from the creator's pool, and the pool itself must stay rent-exempt (~0.00089 SOL).
const DRIP_SLOT_RENT_SOL = 0.00139896;
const POOL_KEEP_SOL = 0.00089088;
export function slotPoolLine(poolSol: number): string {
  const wallets = Math.max(0, Math.floor((poolSol - POOL_KEEP_SOL) / DRIP_SLOT_RENT_SOL));
  return `The ${+poolSol.toFixed(2)} SOL slot-rent pool covers the first buy of about ${wallets.toLocaleString("en-US")} wallets; after that, new wallets can't buy until someone tops it up.`;
}

/** "Starts at 0.1% of supply and rises 0.1% every 5 minutes: 1% after 45 minutes, …" */
export function timecapSummary(p: Record<string, number | string>): string {
  const start = num(p.capStart, 0.1), step = num(p.capStep, 0.1), every = Math.max(1, num(p.everyMinutes, 5));
  const doubling = String(p.growth ?? "step") === "double";
  const periodsTo = (pct: number) => (pct <= start ? 0 : doubling ? Math.ceil(Math.log2(pct / start)) : Math.ceil((pct - start) / step));
  const fmt = (min: number) => (min < 90 ? `${Math.round(min)} minutes` : min < 60 * 48 ? `${+(min / 60).toFixed(1)} hours` : `${+(min / 1440).toFixed(1)} days`);
  const how = doubling ? `doubles every ${fmt(every)}` : `rises ${+step.toFixed(2)}% every ${fmt(every)}`;
  const marks = [1, 5].filter((m) => m > start).map((m) => `${m}% after ${fmt(periodsTo(m) * every)}`);
  return `Every wallet's max starts at ${+start.toFixed(2)}% of supply and ${how}${marks.length ? `: ${marks.join(", ")}` : ""}. It keeps rising until there's no cap at all, after about ${fmt(periodsTo(100) * every)}. The pool and your wallet are exempt.`;
}

/** "Launch: max buy 2%, max sell 1%. From $100,000: …" */
export function slidecapSummary(p: Record<string, number | string>): string {
  const side = (v: number) => (v > 0 ? `${+v.toFixed(3)}%` : "no cap");
  const rows = String(p.levels ?? "").split(";").map((r) => r.split(":").map(Number)).filter((r) => r.length === 3 && r[0] > 0);
  const steps = rows.map(([usd, buy, sell]) => `from $${usd.toLocaleString("en-US")}: max buy ${side(buy)}, max sell ${side(sell)}`);
  return `At launch: max buy ${side(num(p.buy0, 2))}, max sell ${side(num(p.sell0, 1))} of supply per trade${steps.length ? `. Then ${steps.join("; ")}` : ""}. If the market cap falls back under a level, the one below applies again. Nobody is exempt, including you. Market caps are converted to SOL at launch.`;
}

export function unlockSummary(pct: number, locked: string, beacon: string): string {
  return `${locked} unlocks after ${tokensForPct(pct).toLocaleString("en-US")} of ${beacon} tokens have changed hands (${+pct.toFixed(2)}% of the Beacon's supply). Buys, sells and wallet transfers all count, and once it unlocks it stays unlocked.`;
}

export type NodeType = {
  /** A one-line, plain-English readout of the chosen settings (shown under them in the launcher). */
  summary?: (p: Record<string, number | string>) => string;
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  program: string;
  statePrefix: string; // state PDA seed prefix, e.g. "os"
  preview: PreviewKind;
  accent: "a" | "b";
  needsPartner?: "one" | "many";
  partnerHint?: string;
  // node ids that are valid partners (the feed-family a coupled behavior can actually read)
  partnerFamily?: string[];
  params: Param[];
  // Map UI params -> ordered initialize args. supplyRaw = total supply in raw base units.
  // ctx carries runtime side-token addresses for emit/distrib behaviors.
  toInitArgs: (p: Record<string, number | string>, supplyRaw: bigint, ctx?: InitCtx) => InitArg[];
  // Which UI params are coupling references (partner mints) for the graph.
  couplingKeys?: string[];
  family?: Family;
  // core = the behaviors people actually launch (fair-launch / buyback / rewards); advanced =
  // the physics + coupling suite, kept as proof the engine enforces anything, tucked behind a drawer.
  tier?: "core" | "advanced";
  // verified = confirmed live on a Meteora swap; safe = mint-keyed seeds, same resolution class;
  // client = enforced on-chain but its extra account is derived from the buyer, which stock DEX
  // aggregators can't resolve — trade via a Hooked-aware client.
  meteora?: "verified" | "safe" | "client";
  // Some hooks (hlazy) take an extra writable pool PDA in `initialize`, inserted before the
  // system program. Set the seed prefix here and the init builder derives + inserts it.
  initPoolSeed?: string;
  /// treas: a second PDA passed to initialize after the rent pool (the treasury vault, or
  /// mode 2's cap schedule).
  initVaultSeed?: string;
  /// non-default initializer name in the IDL (dues tiers use their own).
  initIx?: string;
  // A few hooks (ghook) store all their config in the ExtraAccountMetaList and have NO state
  // PDA — the init builder omits the state account for these.
  noState?: boolean;
  // Emission/reward behaviors create a side token; the pipeline builds mint+vault before init.
  sideToken?: "emit" | "distrib";
  postLaunch?: "burn" | "claim" | "claimToken"; // burn=settle_burn; claim=drip SOL dividend; claimToken=drip token dividend
  // Reward behaviors whose vault is claimable pro-rata: the pipeline routes the reward vault to
  // the stakepool program's per-mint authority + creates a stake vault + opens the pool, and the
  // node page shows stake/unstake/claim. (halving + jackpot.)
  stakePool?: boolean;
  // Merkle-allowlist behavior: the launch UI collects a wallet list, toInitArgs hashes it into a
  // root, and the full list is stored in the registry so the buyer's client can build a proof.
  allowlist?: boolean;
  // payout (real-asset dividends): the launch flow creates + funds a per-mint treasury of an
  // existing reward token (the creator names the mint + funding amount) and passes it into init.
  payoutTreasury?: boolean;
  /** Airdrop: initialised through app/lib/node/airdrop.ts (claim-based vault of tokens or NFTs). */
  airdrop?: boolean;
  /** Market-cap Beacon/Entangled: initialised through app/lib/node/capgate.ts. */
  capgate?: "beacon" | "entangled";
  /** Max per wallet (balance cap, the CappedPad hook): initialised through app/lib/node/maxhold.ts. */
  maxhold?: boolean;
  /** P2P-only launch (creator can buy the curve): initialised through app/lib/node/p2p.ts. */
  p2p?: boolean;
  /** Graduated sell caps without per-wallet state: initialised through app/lib/node/sellcap.ts. */
  sellcap?: boolean;
  /** Buys only when co-signed by an app's signing wallet (FOMO): initialised through app/lib/node/cosign.ts. */
  cosign?: boolean;
  /** The launch includes a required dev buy (param `devBuySol`) right after the rule goes on. */
  devBuy?: boolean;
  /** Combined rules (several rules on one hook): initialised through app/lib/node/combo.ts. */
  combo?: boolean;
  /** Buys only inside one app's program (Pump App only): initialised through app/lib/node/appgate.ts. */
  appgate?: boolean;
  /** Buys only in FOMO or the Pump app (Social trading): initialised through app/lib/node/social.ts. */
  social?: boolean;
  /** Buys only on OpenSea (OpenSea only): initialised through app/lib/node/opensea.ts. */
  opensea?: boolean;
  /** Buyer must still hold a minimum of SOL or USDC (Skin in the game): initialised through app/lib/node/skin.ts. */
  skin?: boolean;
  /** The biggest buy holds a crown that earns the pool's creator fee (King of the Hill): initialised through app/lib/node/king.ts. */
  king?: boolean;
  /** The pool's trading fee for tokens with this rule, when it isn't the standard 1% to the platform:
   *  the fee in basis points and the percentage of it that goes to the pool's creator. */
  poolFee?: { bps: number; creatorPct: number };
  /** A ready-made rule that runs on the rules engine: turns its settings into rule source, which is
   *  compiled and put on-chain exactly like a Custom hook's (app/lib/node/engine). */
  rulesSource?: (p: Record<string, number | string>) => string;
  /** The creator's own rule set, written with AI and run by the rules engine (Custom hook): set up through app/lib/node/engine/client.ts. */
  custom?: boolean;
  /** A Custom hook whose rules can be replaced after launch, and by whom: "creator" = the launching
   *  wallet, whenever it likes (Editable hook); "keeper" = Hooked's keeper, when a holder vote passes
   *  (DAO hook). 5% of these tokens' fees is set aside to pay for the changes (app/lib/editFund.ts). */
  editable?: "creator" | "keeper";
  /** Trades only on the days and hours its creator set, in any time zone (Trading hours): initialised through app/lib/node/schedule.ts. */
  schedule?: boolean;
  /** Named wallets can never receive the token (Blocklist): initialised through app/lib/node/blocklist.ts. */
  blocklist?: boolean;
  /** The latest buyer can't sell until someone buys after them (Hot potato): initialised through app/lib/node/potato.ts. */
  potato?: boolean;
  /** Every whole unit held is a numbered object (Pegs): initialised through app/lib/node/pegs.ts. */
  pegs?: boolean;
  /** Buy cap driven by an on-chain oscillator (Physics in tokens): initialised through app/lib/node/physics.ts. */
  physics?: "breathing" | "momentum" | "resonance" | "coupled";
  /** Buys and sells take turns (Ping Pong): initialised through app/lib/node/pingpong.ts. */
  pingpong?: boolean;
  /** Rising max per wallet on a timer: initialised through app/lib/node/timecap.ts. */
  timecap?: boolean;
  /** Sniper-fee cap (priority fee / Jito tip limit at launch): initialised through app/lib/node/feecap.ts. */
  feecap?: boolean;
  /** Market hours (NYSE session only): initialised through app/lib/node/hours.ts. */
  hours?: boolean;
  /** Sliding caps (max buy / max sell change at market-cap levels): initialised through app/lib/node/slidecap.ts. */
  slidecap?: boolean;
  /** The pool can be priced in a tokenized stock (app/lib/stocks.ts) instead of SOL. */
  stockPair?: boolean;
  // Behaviors whose whole point is that the hook comes OFF at graduation must launch on a
  // normal (graduating) curve — the launch UI pins the choice and explains why.
  forceCurve?: "normal" | "infinite";
  // Rolling-waitlist behaviors: the launch also opens a ["gkctl", mint] account naming the
  // creator as the authority allowed to publish later allowlist waves.
  rootControl?: boolean;
  // Two-class launches need the presale window resolved into an ABSOLUTE slot at launch time,
  // which only the pipeline knows — it reads the chain clock and passes it via InitCtx.
  presaleCutoff?: boolean;
};

function num(v: number | string | undefined, d: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : d;
}
// Reward-token amounts scale by the REWARD mint's decimals (creator-selectable 0–9), not the
// coin's fixed 6. `initializeNode` injects `rewardDecimals` into params for side-token behaviors,
// so `toInitArgs` can size emissions correctly instead of assuming 1e6.
function rewardUnit(p: Record<string, number | string>): bigint {
  return 10n ** BigInt(Math.min(9, Math.max(0, Math.round(num(p.rewardDecimals, 6)))));
}
export function pctRaw(pct: number, supplyRaw: bigint): bigint {
  // pct of supply in raw units, avoiding float overflow: pct scaled by 1e4
  return (supplyRaw * BigInt(Math.round(pct * 10_000))) / 1_000_000n;
}
export function omega2Scaled(periodSec: number): bigint {
  const w = (2 * Math.PI) / Math.max(1, periodSec);
  return BigInt(Math.round(w * w * 1_000_000));
}
function pkList(v: number | string | undefined): PublicKey[] {
  return String(v ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => new PublicKey(s));
}
// Parse a comma/space-separated list of positive integers (member weights). Blank → [].
function numList(v: number | string | undefined): number[] {
  return String(v ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => Math.max(1, Math.round(parseFloat(s) || 1)));
}

// Coupled behaviors read a PARTNER token's live on-chain FEED — which is that token's state
// PDA, not its mint. Derive the feed address here so the hook is handed the readable account.
// Reactive-family feeds (buy_vol@10 / sell_vol@18) live under the pulse program, seed "ps";
// entangled/beacon volume metric lives under the twin program, seed "tw".
const PULSE_PROGRAM = new PublicKey("BCiJ49rbFS7Lw6QfbxweBQ5a4RVsif12kHBnx4QHBUxM");
const TWIN_PROGRAM = new PublicKey("5aAXdggDpJBtAfDoFusTp44tj5XpBXbxuCwDqpc17SBb");
function feedPda(mint: PublicKey | string | number | undefined, prefix: string, program: PublicKey): PublicKey {
  const s = typeof mint === "object" ? mint : String(mint ?? "").trim() ? new PublicKey(String(mint).trim()) : null;
  if (!s) return PublicKey.default;
  return PublicKey.findProgramAddressSync([new TextEncoder().encode(prefix), s.toBytes()], program)[0];
}
const psFeed = (m: PublicKey | string | number | undefined) => feedPda(m, "ps", PULSE_PROGRAM);
const twFeed = (m: PublicKey | string | number | undefined) => feedPda(m, "tw", TWIN_PROGRAM);

export const NODE_TYPES: NodeType[] = [
  {
    id: "fomo",
    name: "FOMO-only buys",
    tagline: "It can only be bought through the FOMO app.",
    blurb:
      "Every buy from the Meteora pool has to come through the FOMO app: the hook checks that FOMO's own signing wallet co-signed the transaction, and refuses the buy otherwise. Sells and wallet-to-wallet sends are never blocked, so holders can always exit. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy on FOMO. This lets the dev open up the pool on FOMO, which takes a few buys to trigger. When the curve graduates, Meteora switches the rule off and it trades anywhere.",
    program: "4Tabcoy1niosiNAGHMruLBFscgJWXZsVF3pfij3FqMB5",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "safe",
    cosign: true,
    devBuy: true,
    params: [
      { key: "devBuySol", label: "Dev buy", help: "required: your first buy from the curve, made right after the rule is switched on", type: "range", min: 0.01, max: 10, step: 0.01, default: 0.1, unit: "SOL" },
    ],
    summary: (p) => `Your ${num(p.devBuySol, 0.1)} SOL dev buy goes in right after the rule is switched on. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy on FOMO. This lets the dev open up the pool on FOMO, which takes a few buys to trigger. Selling and sending always work for everyone.`,
    toInitArgs: () => [], // not used: see app/lib/node/cosign.ts
  },
  {
    id: "pumpapp",
    name: "Pump App only",
    tagline: "It can only be bought in the Pump app.",
    blurb:
      "Every buy from the Meteora pool has to be made in the Pump app: the Pump app buys a token like this through Jupiter's app API and the OKX router, and the swap Jupiter builds for it carries a tag that jup.ag's own swaps don't. The hook only lets a buy through when it runs through that router and carries that tag. Buying on jup.ag, in FOMO, through trading terminals like Axiom and Photon, or straight from the pool is refused. Another app built on the same Jupiter API could also get through, which has been about 1 buy in 70 so far. Sells and wallet-to-wallet sends are never blocked, so holders can always exit. The dev wallet is permanently whitelisted, so you can buy anywhere with it. When the curve graduates, Meteora switches the rule off and it trades anywhere.",
    program: "BXax2KXrnT7qRf7cva9cLJpqDGXWywsw4ucLwtGiTa28",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "safe",
    appgate: true,
    devBuy: true,
    params: [
      { key: "devBuySol", label: "Dev buy", help: "required: your first buy from the curve, made right after the rule is switched on", type: "range", min: 0.01, max: 10, step: 0.01, default: 0.1, unit: "SOL" },
    ],
    summary: (p) => `Your ${num(p.devBuySol, 0.1)} SOL dev buy goes in right after the rule is switched on. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy in the Pump app. Selling and sending always work for everyone.`,
    toInitArgs: () => [], // not used: see app/lib/node/appgate.ts
  },
  {
    id: "social",
    name: "Social trading",
    tagline: "It only trades in FOMO or the Pump app: buys and sells.",
    blurb:
      "Every trade with the Meteora pool, buying and selling, has to be made in one of two apps. A FOMO trade is recognised by FOMO's own signature on the transaction, which nobody else can produce. A Pump app trade is recognised by the route it takes: the Pump app trades through Jupiter's app API and the OKX router, and the swap built for it carries a tag that jup.ag's own swaps don't. Trading on jup.ag, through terminals like Axiom and Photon, or straight with the pool is refused, in both directions. The Pump half isn't forgery-proof: another app built on the same Jupiter API could also get through. Because sells are restricted too, holders have no exit outside the two apps: if both ever stop trading the token, nobody can sell it. The rule only lifts if the curve graduates. Wallet-to-wallet sends always work. The dev wallet is permanently whitelisted, so you can buy and sell anywhere with it. When the curve graduates, Meteora switches the rule off and it trades anywhere.",
    program: "DMohCzuYMQUsmYAiitgtYtSpsBtyEw9UWZha7EGqTv8M",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "safe",
    social: true,
    devBuy: true,
    params: [
      { key: "devBuySol", label: "Dev buy", help: "required: your first buy from the curve, made right after the rule is switched on", type: "range", min: 0.01, max: 10, step: 0.01, default: 0.1, unit: "SOL" },
    ],
    summary: (p) => `Your ${num(p.devBuySol, 0.1)} SOL dev buy goes in right after the rule is switched on. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy and sell in FOMO or the Pump app; sending between wallets always works. If both apps ever stop trading the token, holders can't sell it anywhere.`,
    toInitArgs: () => [], // not used: see app/lib/node/social.ts
  },
  {
    id: "opensea",
    name: "OpenSea only",
    tagline: "It only trades on OpenSea: buys and sells.",
    blurb:
      "Every trade with the Meteora pool, buying and selling, has to be made on OpenSea: every swap made on OpenSea carries OpenSea's own marker (a memo, sometimes also its wallet's signature), and the hook refuses any trade without it. Ordinary apps and bots don't add that marker, though anyone building their own transaction could. Because sells are restricted too, holders have no exit outside OpenSea. OpenSea hasn't yet been seen trading a token still on its bonding curve; if it can't, nobody but you can buy or sell until the curve graduates, and holders can only send it between wallets. Wallet-to-wallet sends always work. The dev wallet is permanently whitelisted, so you can buy and sell anywhere with it. When the curve graduates, Meteora switches the rule off and it trades anywhere.",
    program: "VqzxRoumJqbx99dQeWDoRC5XL48r5ZZYANwCgpuWVPW",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "safe",
    opensea: true,
    devBuy: true,
    params: [
      { key: "devBuySol", label: "Dev buy", help: "required: your first buy from the curve, made right after the rule is switched on", type: "range", min: 0.01, max: 10, step: 0.01, default: 0.1, unit: "SOL" },
    ],
    summary: (p) => `Your ${num(p.devBuySol, 0.1)} SOL dev buy goes in right after the rule is switched on. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy and sell on OpenSea; sending between wallets always works. If OpenSea doesn't trade the token, holders can't sell it anywhere.`,
    toInitArgs: () => [], // not used: see app/lib/node/opensea.ts
  },
  {
    id: "sellcaps",
    name: "Graduated sell caps",
    tagline: "The bigger your bag, the less you can sell in one go.",
    blurb:
      "Small holders sell freely, but the bigger a wallet's bag, the smaller its per-sell cap, down to a floor. A whale can build a position but can't dump it in one sell. The hook reads the bag straight from the sell, so there's nothing to fund and no minimum buy. Buys and wallet-to-wallet sends are never capped.",
    program: "9Am6KfHqhi3vYmZKpE2kRJxmbNvwggujNzqqSaqdor2Z",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Caps",
    meteora: "safe",
    sellcap: true,
    params: [
      { key: "baseSellCap", label: "Sell cap for small holders", help: "the most a small holder can sell in one go", type: "pct", min: 0.05, max: 5, step: 0.05, default: 1, unit: "% supply" },
      { key: "floorSellCap", label: "Sell cap for the biggest bags", help: "the least any wallet can sell in one go", type: "pct", min: 0.01, max: 1, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "tightenAt", label: "Bag size that gets the smallest cap", help: "a wallet holding this much or more can only sell the smallest cap at a time", type: "pct", min: 0.5, max: 10, step: 0.5, default: 3, unit: "% supply" },
    ],
    summary: (p) => {
      const base = num(p.baseSellCap, 1), floor = Math.min(num(p.floorSellCap, 0.1), base), at = num(p.tightenAt, 3);
      const mid = Math.max(floor, base - (at / 2) * (base - floor) / at);
      return `A wallet with a tiny bag can sell up to ${base}% of supply at once. At a ${+(at / 2).toFixed(2)}% bag that falls to ${+mid.toFixed(3)}%, and at ${at}% or more it's ${floor}% per sell.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/sellcap.ts
  },
  {
    id: "p2p",
    name: "P2P-only",
    tagline: "Moves wallet to wallet only until it graduates. Only you can buy the curve.",
    blurb:
      "Nobody can buy or sell it on a market: the hook refuses any transfer a program makes, so it only moves when a wallet sends it to another wallet. The one exception is your own wallet, which can buy from the bonding curve (all of it, if you like) and hand tokens out. When the curve fills up, the token graduates and Meteora switches the rule off, so from then on it trades normally everywhere.",
    program: "B9HAaxbFnz868uYsVPWBJr1hL2cfZvXqzhssR3V2VQaT",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "safe",
    p2p: true,
    forceCurve: "normal",
    params: [],
    summary: () => "Only your wallet can buy from the curve. Everyone else gets it wallet to wallet from you or each other. The buy that fills the curve graduates the token and switches the rule off. After launch you can buy from the curve here or in My vault.",
    toInitArgs: () => [], // not used: see app/lib/node/p2p.ts
  },
  {
    id: "maxhold",
    name: "Max per wallet",
    tagline: "No wallet can hold more than a set share of supply.",
    blurb:
      "After every buy or transfer the hook checks what the receiving wallet now holds, and refuses the trade if it would go over your cap, for example 1% of supply. The Meteora pool is exempt so trading and graduation work, and so is your own wallet. No per-wallet setup and nothing to fund.",
    program: "BVM8FK38fAJdWj4pezJh9xHaYaektV4f5Df9dq7y5TDC",
    statePrefix: "config",
    preview: "gate",
    accent: "a",
    family: "Caps",
    meteora: "safe",
    maxhold: true,
    params: [
      { key: "maxWallet", label: "Max per wallet", type: "pct", min: 0.1, max: 5, step: 0.1, default: 1, unit: "% supply" },
    ],
    toInitArgs: () => [], // not used: see app/lib/node/maxhold.ts
  },
  {
    id: "hours",
    name: "Market hours",
    tagline: "Trades like a stock: Monday to Friday, 9:30am to 4pm New York time.",
    blurb:
      "The token only trades during the stock market's regular session: Monday to Friday, 9:30am to 4:00pm New York time, with daylight saving handled automatically. Outside those hours the hook refuses the trade. You choose whether sells stay open around the clock and whether stock-market holidays are observed. Sending between wallets always works, and your own wallet can always buy.",
    program: "EZet2oSoussVujse5U8W4T2NZsTuJ1rZBqQ8J188iJKk",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    hours: true,
    stockPair: true,
    params: [
      { key: "afterHours", label: "After hours", type: "choice", default: "closed", options: [{ value: "closed", label: "Buys and sells closed" }, { value: "sells", label: "Sells stay open" }] },
      { key: "holidays", label: "Stock-market holidays", type: "choice", default: "observe", options: [{ value: "observe", label: "Closed on holidays" }, { value: "ignore", label: "Ignore holidays" }] },
    ],
    summary: (p) => `Trading is open Monday to Friday, 9:30am to 4:00pm New York time${String(p.holidays ?? "observe") === "observe" ? ", and closed on stock-market holidays like Thanksgiving and Christmas" : ""}. Outside those hours ${String(p.afterHours ?? "closed") === "sells" ? "buys are refused but holders can still sell" : "both buys and sells are refused, so holders can't exit until the market reopens"}. Wallet-to-wallet sends always work and your wallet can always buy.`,
    toInitArgs: () => [], // not used: see app/lib/node/hours.ts
  },
  {
    id: "king",
    name: "King of the Hill",
    tagline: "The biggest buy takes the crown and earns from every trade.",
    blurb:
      "The largest qualifying buy holds the crown. To steal it, another wallet has to beat the King's winning buy, which slowly decays so the throne never becomes unreachable. While they hold the crown the King earns about 0.5% of every trade, paid in SOL by the program itself; selling or sending any tokens gives the crown up. The token page shows the King, the winning buy, the reign and a Hall of Kings. These tokens trade with a 1.65% fee instead of 1%, and they trade on any DEX. The game runs while the token is on its curve, so pick the Permanent curve to keep it going.",
    program: "63VLLdKEZVjwKN4Y6CqeeFkLGzMoSZxFAXsfiLwnKKkD",
    statePrefix: "king",
    preview: "gate",
    accent: "a",
    family: "Rewards",
    meteora: "safe",
    king: true,
    poolFee: { bps: 165, creatorPct: 38 },
    params: [
      { key: "minBuySol", label: "Smallest buy that can take the crown", type: "range", min: 0.01, max: 10, step: 0.01, default: 0.1, unit: "SOL" },
      { key: "stepPct", label: "A challenger must beat the King by", type: "range", min: 0, max: 50, step: 1, default: 5, unit: "%" },
      { key: "halfLifeUnit", label: "The bar to beat halves every", type: "choice", default: "hour", options: [{ value: "minute", label: "Minutes" }, { value: "hour", label: "Hours" }, { value: "day", label: "Days" }, { value: "never", label: "Never (it only rises)" }] },
      { key: "halfLifeEvery", label: "How many", type: "range", min: 1, max: 60, step: 1, default: 6, unit: "" },
      { key: "creatorCanRule", label: "Can your own wallet be King?", type: "choice", default: "no", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
    ],
    summary: (p) => {
      const never = String(p.halfLifeUnit ?? "hour") === "never", n = Math.round(num(p.halfLifeEvery, 6)), u = String(p.halfLifeUnit ?? "hour");
      return `The first buy of ${num(p.minBuySol, 0.1)} SOL or more takes the crown. After that a wallet has to beat the King's winning buy by ${num(p.stepPct, 5)}% in a single buy. ${never ? "The bar never comes down, so each takeover has to be bigger than the last." : `The bar halves every ${n} ${u}${n === 1 ? "" : "s"}, down to ${num(p.minBuySol, 0.1)} SOL.`} The King earns about 0.5% of every trade in SOL and loses the crown by selling or sending any tokens. ${String(p.creatorCanRule ?? "no") === "yes" ? "Your own wallet can be King too." : "Your own wallet can't be King."} Trades carry a 1.65% fee.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/king.ts
  },
  {
    id: "conviction",
    name: "Conviction cap",
    tagline: "Hold without selling and your own buy limit grows.",
    blurb:
      "The opposite of a flat whale cap. Every wallet starts with a small limit per buy; each minute, hour or day it holds without selling (you choose), its own limit climbs, up to a ceiling you set. Sell and that wallet's clock starts again. New money is throttled while proven holders earn the right to buy bigger. Sells are never capped, your own wallet is exempt, and it trades on any DEX.",
    program: "9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL",
    statePrefix: "rules",
    preview: "ratchet",
    accent: "a",
    family: "Caps",
    meteora: "safe",
    rulesSource: convictionRules,
    params: [
      { key: "startCap", label: "Starting buy cap", help: "the most a wallet can buy at once when it's new, or has just sold", type: "pct", min: 0.01, max: 2, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "growthUnit", label: "Cap grows every", type: "choice", default: "day", options: [{ value: "minute", label: "Minute" }, { value: "hour", label: "Hour" }, { value: "day", label: "Day" }] },
      { key: "growthPerDay", label: "Growth each time", help: "how much a wallet's cap rises for every full minute, hour or day it holds without selling", type: "pct", min: 0.01, max: 2, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "maxCap", label: "Cap ceiling", type: "pct", min: 0.1, max: 10, step: 0.1, default: 2, unit: "% supply" },
      { key: "histCap", label: "Wallets remembered", help: "how many recent traders the hook keeps track of; a wallet that falls off the list starts again at the starting cap. More wallets cost more rent at launch", type: "range", min: 1000, max: 100000, step: 1000, default: 1000, unit: "wallets" },
    ],
    summary: (p) => {
      const s = num(p.startCap, 0.1), g = num(p.growthPerDay, 0.1), m = Math.max(s, num(p.maxCap, 2));
      const steps = Math.ceil(+((m - s) / g).toFixed(6)), u = convictionUnit(p).word;
      return `A new wallet can buy up to ${s}% of supply at a time. Each full ${u} it holds without selling adds ${g}%, up to ${m}%${steps > 0 ? ` (reached after ${steps} ${u}${steps === 1 ? "" : "s"})` : ""}. Selling sets that wallet back to ${s}%. Sells are never capped and your wallet is exempt. The hook remembers the latest ${histCapOf(p).toLocaleString("en-US")} traders (about ${histRentSol(histCapOf(p)).toFixed(2)} SOL of rent at launch); a wallet that falls out of that list starts again at ${s}%.`;
    },
    toInitArgs: () => [], // not used: the rules engine (app/lib/node/engine/client.ts)
  },
  {
    id: "custom",
    name: "Custom hook",
    tagline: "Describe the rule you want and AI writes the hook.",
    blurb:
      "Your own rules, written with AI. Say what you want the token to do, in your own words; the AI writes it as a short rule set, checks it with the real compiler and tests it, and you can edit every line. The rules can look at the trade, each wallet's own buys and sells, the clock in any time zone, the market cap, the transaction's fees and which app sent it. They are stored on-chain at launch, run on every transfer, can never change, and the token still trades on any DEX.",
    program: "9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL",
    statePrefix: "rules",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    custom: true,
    params: [],
    toInitArgs: () => [], // not used: see app/lib/node/engine/client.ts
  },
  {
    id: "editable",
    name: "Editable hook",
    tagline: "A Custom hook you can rewrite at any time, forever.",
    blurb:
      "A Custom hook whose rules are never locked. You launch with any rule set (or none) and can replace it whenever you like, as often as you like, with the same AI builder: only your wallet can make a change, and every change is made on-chain and shown on the token's page. 5% of the token's trading fees is set aside as its own fund that pays for the AI work on its rules; the other 80% still goes to the Hooked buyback and burn. Holders should know the rules can change, including rules about selling. It still trades on any DEX, with the normal 1% fee.",
    program: "9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL",
    statePrefix: "rules",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    custom: true,
    editable: "creator",
    params: [
      { key: "notice", label: "Notice before a change takes effect", help: "a new rule set is published on-chain and waits this long, in public view, before it replaces the current one", type: "choice", default: "0", options: [{ value: "0", label: "None" }, { value: "600", label: "10 minutes" }, { value: "3600", label: "1 hour" }, { value: "86400", label: "24 hours" }] },
    ],
    summary: (p) => `Only your wallet can change this token's rules, at any time, for as long as the token exists. ${noticeSec(p) ? `A change waits ${noticeWords(p)} on-chain before it takes effect.` : "A change takes effect as soon as you send it."} 5% of the token's trading fees goes into its own fund for AI help with the rules; 80% goes to the Hooked buyback and burn. The rules (and any changes) only apply while the token is on its curve, so choose the Permanent curve to keep them for the life of the token.`,
    toInitArgs: () => [], // not used: see app/lib/node/engine/client.ts
  },
  {
    id: "dao",
    name: "DAO hook",
    tagline: "Holders vote on the rules, and AI rewrites the hook.",
    blurb:
      "A Custom hook run by its holders. Anyone holding the minimum you set can sign in with their wallet, post an idea for the token's rules and vote ideas up or down. When an idea reaches the number of votes you set, the AI builder turns it into a rule set, checks and tests it, and Hooked's keeper puts it on-chain. Nobody, including you, can change the rules any other way. 5% of the token's trading fees is set aside as its own fund that pays for the AI work and the changes; the other 80% still goes to the Hooked buyback and burn. It still trades on any DEX, with the normal 1% fee.",
    program: "9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL",
    statePrefix: "rules",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    custom: true,
    editable: "keeper",
    params: [
      { key: "minHold", label: "Tokens needed to take part", help: "a wallet must hold at least this many tokens to post an idea or vote", type: "range", amount: true, min: 1, max: 100000000, step: 1, default: 1000000, unit: "tokens" },
      { key: "votesToPass", label: "Votes for an idea to pass", help: "an idea passes when its upvotes minus its downvotes reach this number, counting only wallets that still hold the minimum", type: "range", amount: true, min: 1, max: 100000, step: 1, default: 25, unit: "votes" },
      { key: "notice", label: "Notice before a change takes effect", help: "a new rule set is published on-chain and waits this long, in public view, before it replaces the current one", type: "choice", default: "0", options: [{ value: "0", label: "None" }, { value: "600", label: "10 minutes" }, { value: "3600", label: "1 hour" }, { value: "86400", label: "24 hours" }] },
    ],
    summary: (p) => `A wallet holding ${daoMinHold(p).toLocaleString("en-US")} tokens or more can post ideas and vote. An idea passes at ${daoVotes(p).toLocaleString("en-US")} net vote${daoVotes(p) === 1 ? "" : "s"}: the AI turns it into rules and Hooked's keeper puts them on-chain${noticeSec(p) ? `, where they wait ${noticeWords(p)} before taking effect` : ""}. You can't change the rules yourself. 5% of the token's trading fees goes into its own fund for the AI work and the changes; 80% goes to the Hooked buyback and burn. The rules (and any changes) only apply while the token is on its curve, so choose the Permanent curve to keep them for the life of the token.`,
    toInitArgs: () => [], // not used: see app/lib/node/engine/client.ts
  },
  {
    id: "schedule",
    name: "Trading hours",
    tagline: "Trades only on the days and hours you set, in any time zone.",
    blurb:
      "You set the trading week: which days the token trades and the hours on each day, in any time zone in the world, with daylight saving followed automatically. Outside those hours the hook refuses the trade. A day can run past midnight or stay open all day. You choose whether sells stay open around the clock. Sending between wallets always works, your own wallet can always buy, and the hours are fixed at launch.",
    program: "BUwCiwrRfVgNKEhHryBb626oKCRqNfm5hhkebrXKG6iY",
    statePrefix: "hours",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    schedule: true,
    params: [
      { key: "afterHours", label: "Outside your hours", type: "choice", default: "closed", options: [{ value: "closed", label: "Buys and sells closed" }, { value: "sells", label: "Sells stay open" }] },
    ],
    summary: (p) => `Trading is open ${describeHours(parseHours(p.hours))}, ${String(p.tz || "UTC").replace(/_/g, " ")} time. Outside those hours ${String(p.afterHours ?? "closed") === "sells" ? "buys are refused but holders can still sell" : "both buys and sells are refused, so holders can't exit until trading reopens"}. Wallet-to-wallet sends always work and your wallet can always buy.`,
    toInitArgs: () => [], // not used: see app/lib/node/schedule.ts
  },
  {
    id: "skin",
    name: "Skin in the game",
    tagline: "Only wallets that still hold real SOL or USDC after buying can buy.",
    blurb:
      "Bot farms buy from wallets funded with dust. With this rule, a buy only goes through if the buyer still holds at least your minimum of SOL, or of USDC, after paying for it. You set both minimums, and either can be 0 to leave that currency out: for example 0 SOL and 500 USDC means only wallets holding 500 USDC can buy. Sells and wallet-to-wallet sends are never blocked, and your own wallet is exempt. The hook reads the buyer's own wallet and USDC balance, which trading apps like Jupiter and Axiom don't supply, so the token is bought and sold on its Hooked page. A determined bot can still top a wallet up for the length of one transaction; this stops cheap dust-wallet farms.",
    program: "2zSiLjfBo5t6arSCk5o9UyLGascwyLooGVhdLHcRBsje",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "client",
    skin: true,
    params: [
      { key: "minSol", label: "Minimum SOL", help: "the buyer must still hold this much SOL after the buy; 0 = SOL doesn't count", type: "range", min: 0, max: 1000, step: 0.01, default: 0.5, unit: "SOL", amount: true },
      { key: "minUsdc", label: "Minimum USDC", help: "or this much USDC; 0 = USDC doesn't count", type: "range", min: 0, max: 1_000_000, step: 1, default: 50, unit: "USDC", amount: true },
    ],
    summary: (p) => {
      const sol = num(p.minSol, 0.5), usdc = num(p.minUsdc, 50);
      const need = [sol > 0 ? `${sol} SOL` : "", usdc > 0 ? `${usdc.toLocaleString("en-US")} USDC` : ""].filter(Boolean).join(" or ");
      return need
        ? `A buy only goes through if the buyer still holds at least ${need} after paying. Sells and sends are never blocked and your wallet is exempt. The token trades on its Hooked page, not on Jupiter or Axiom.`
        : "Set a minimum of SOL, USDC or both.";
    },
    toInitArgs: () => [], // not used: see app/lib/node/skin.ts
  },
  {
    id: "pingpong",
    name: "Ping Pong",
    tagline: "Buys and sells take turns: one buy, then one sell, forever.",
    blurb:
      "Every trade with the pool has to answer the last one: after a buy the next trade must be a sell, and after a sell it must be a buy. Two buys or two sells in a row are refused, for everyone, the creator included. A trade smaller than your minimum still goes through when it's its turn, but doesn't hand the turn over, so dust can't play the game. Two trades of the token in one transaction are refused, so nobody can sneak a tiny opposite trade in with their real one. If nobody takes the turn for the time you set, either side can go next, so a quiet token never gets stuck. Wallet-to-wallet sends always work. The first trade must be a buy.",
    program: "Bf7ecqFieSoacTNbangY4trvnU7bVig6na1RMr6G84dk",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    pingpong: true,
    params: [
      { key: "minTurnPct", label: "Minimum to take the turn", help: "smaller trades still go through on their own turn but don't hand it over", type: "pct", min: 0, max: 1, step: 0.001, default: 0.01, unit: "% supply", numeric: true },
      { key: "freeAfterMin", label: "Turn frees up after", help: "if nobody takes the turn this long, either side can go next; 0 = never", type: "range", min: 0, max: 1440, step: 1, default: 10, unit: "minutes" },
    ],
    summary: (p) => {
      const pct = num(p.minTurnPct, 0.01), min = num(p.freeAfterMin, 10);
      return `Strictly one buy, then one sell. A trade needs at least ${pct}% of supply to hand the turn over. ${min > 0 ? `If nobody takes the turn for ${min} minute${min === 1 ? "" : "s"}, either side can go next.` : "The turn never frees up on its own."} Nobody is exempt, you included, and the first trade must be a buy. Sends between wallets always work.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/pingpong.ts
  },
  {
    id: "pegs",
    name: "Pegs",
    tagline: "Every whole unit you hold is a numbered object with its own art.",
    blurb:
      "The supply is split into a fixed collection of numbered objects, up to 65,535. Every whole unit a wallet holds is one of them, with its own number and its own art: buy across a whole unit and a new number is minted to you, sell below it and your newest one is burned back to the pool, and sending tokens to a friend moves your newest objects with them. Upload your own art at launch, one image per object or a smaller set shared across the numbers, or let Hooked draw one from each number. Trading is never blocked by the objects: a wallet that bought elsewhere claims its objects on the token page. Buys and sells happen on the token's Hooked page.",
    program: "2JwcGx9cUK1UyTsztkRAnCeAPgbJXkwCqSP9ghkPi3Md",
    statePrefix: "pcfg",
    preview: "gate",
    accent: "b",
    family: "Rewards",
    meteora: "client",
    pegs: true,
    params: [
      { key: "objects", label: "Objects in the collection", help: "one per whole unit, up to 65,535; with 1B supply, 10,000 objects makes a unit 100,000 tokens", type: "range", min: 1, max: 65535, step: 1, default: 10000, unit: "objects", amount: true },
    ],
    summary: (p) => {
      const n = Math.min(65_535, Math.max(1, Math.round(num(p.objects, 10_000))));
      return `${n.toLocaleString("en-US")} numbered objects, one for every ${(1_000_000_000 / n).toLocaleString("en-US", { maximumFractionDigits: 2 })} tokens held. Buying across a whole unit mints a number to you, selling below one burns your newest, and sending tokens moves your newest objects with them.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/pegs.ts
  },
  {
    id: "potato",
    name: "Hot potato",
    tagline: "The latest buyer can't sell until someone buys after them.",
    blurb:
      "Whoever bought last is holding the hot potato: they can't sell or send the token until a different wallet buys after them, which passes the potato on. Everyone else trades and sends freely, and buys are never blocked. A buy has to be at least your minimum to pass the potato, so a dust buy from a friend's wallet can't free the holder. You can also let the potato go cold after a while, so a holder isn't stuck if trading goes quiet. Nobody is exempt, you included.",
    program: "CapP1YJk8Rh4d17szh45zXHy8vSMbZoNXfzm6zvNTgz7",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    potato: true,
    params: [
      { key: "minPassPct", label: "Minimum buy to pass the potato", help: "smaller buys go through but don't pass it on", type: "pct", min: 0, max: 1, step: 0.001, default: 0.01, unit: "% supply", numeric: true },
      { key: "coldAfterMin", label: "Potato goes cold after", help: "if nobody buys this long, the holder can sell again; 0 = never", type: "range", min: 0, max: 1440, step: 1, default: 0, unit: "minutes" },
    ],
    summary: (p) => {
      const pct = num(p.minPassPct, 0.01), min = num(p.coldAfterMin, 0);
      return `The latest buyer can't sell or send until another wallet buys at least ${pct}% of supply after them. ${min > 0 ? `If nobody does for ${min} minute${min === 1 ? "" : "s"}, the potato goes cold and they can sell again.` : "It never goes cold on its own."} Everyone else trades freely. Nobody is exempt, you included.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/potato.ts
  },
  {
    id: "blocklist",
    name: "Blocklist",
    tagline: "Named wallets can never receive the token.",
    blurb:
      "The opposite of an allowlist: you name up to 200 wallets that can never receive the token. They can't buy it from the pool and nobody can send it to them; everyone else trades normally. The list is written on-chain at launch and sealed, so it can never change, and the token still trades on any DEX.",
    program: "8zw1psRFN541E1A3uzxB3uBXjUj3dVtkLHS3Ad99dFqP",
    statePrefix: "list",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    blocklist: true,
    params: [],
    toInitArgs: () => [], // not used: see app/lib/node/blocklist.ts
  },
  {
    id: "feecap",
    name: "Sniper-fee cap",
    tagline: "Buys paying sniper-sized priority fees or tips are refused at launch.",
    blurb:
      "Snipers win launches by outbidding everyone with huge priority fees and Jito tips. For a launch window you choose, the hook reads every buy's transaction and refuses it if it pays more than your cap in priority fee or in Jito tips. Normal buyers pay tiny fees, so they never notice. When the window ends, anyone can pay whatever they like. Sells are never blocked, and your own wallet is exempt.",
    program: "BPVEVJfsDvPQ4A8oRntVudUAJyaUvFuSJVk5tidKz7Fp",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    feecap: true,
    params: [
      { key: "windowMinutes", label: "Launch window", help: "how long the cap applies after launch; 0 = forever", type: "range", min: 0, max: 1440, step: 1, default: 10, unit: "minutes" },
      { key: "maxPrioritySol", label: "Max priority fee per buy", help: "normal buyers pay well under 0.001 SOL", type: "range", min: 0.0001, max: 0.05, step: 0.0001, default: 0.002, unit: "SOL" },
      { key: "maxTipSol", label: "Max Jito tip per buy", type: "range", min: 0, max: 0.05, step: 0.0001, default: 0.002, unit: "SOL" },
    ],
    summary: (p) => {
      const w = num(p.windowMinutes, 10);
      const when = w > 0 ? `For the first ${w >= 120 ? `${+(w / 60).toFixed(1)} hours` : `${w} minutes`} after launch` : "For the life of the token";
      return `${when}, a buy paying more than ${num(p.maxPrioritySol, 0.002)} SOL in priority fee or ${num(p.maxTipSol, 0.002)} SOL in Jito tips is refused. Normal buyers pay far less. Sells are never blocked and your wallet is exempt.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/feecap.ts
  },
  {
    id: "timecap",
    name: "Rising max per wallet",
    tagline: "Max per wallet starts small and rises on a timer.",
    blurb:
      "Every wallet's max holding starts small, for example 0.1% of supply, and rises for everyone on a timer: a fixed step or doubling, as often as you choose. It never stops rising, so the token opens up completely over time. Snipers can only grab a tiny bag at launch. The hook reads the receiving wallet's balance after every buy or transfer, so there's nothing to fund and no per-wallet setup. The Meteora pool and your own wallet are exempt.",
    program: "6AH1GVkqUdYCrbse28TcFSLyYTSiYqQVneaxvSBTSyp3",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Caps",
    meteora: "safe",
    timecap: true,
    params: [
      { key: "capStart", label: "Starting max per wallet", type: "pct", min: 0.01, max: 5, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "growth", label: "How it rises", type: "choice", default: "step", options: [{ value: "step", label: "Fixed step" }, { value: "double", label: "Doubles" }] },
      { key: "capStep", label: "Rises by", help: "added to the cap every period", type: "pct", min: 0.01, max: 5, step: 0.01, default: 0.1, unit: "% supply", showIf: { key: "growth", value: "step" } },
      { key: "everyMinutes", label: "Every", help: "how often the cap rises", type: "range", min: 1, max: 1440, step: 1, default: 5, unit: "minutes" },
    ],
    summary: (p) => timecapSummary(p),
    toInitArgs: () => [], // not used: see app/lib/node/timecap.ts
  },
  {
    id: "slidecap",
    name: "Sliding caps",
    tagline: "The max buy and max sell change as the market cap grows.",
    blurb:
      "You set the max per buy and max per sell at launch, then up to five market-cap levels where they change, for example max sell 1% at launch, 0.5% from $100,000 and 0.1% from $1,000,000. On every trade the hook reads the price from the token's own Meteora pool and applies the highest level the market cap has reached, so a whale has to exit in ever smaller pieces as the token grows. If the price falls back under a level, the level below applies again. Caps go as low as 0.001% of supply. Nobody is exempt, including you. Wallet-to-wallet sends are never capped.",
    program: "8uDCgT4KrMNsX6nJzqCFtLansP9AJef4deWWBk4nG9VA",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Caps",
    meteora: "safe",
    slidecap: true,
    params: [
      { key: "buy0", label: "Max per buy at launch", help: "0 = no cap on buys", type: "pct", numeric: true, min: 0, max: 100, step: 0.001, default: 2, unit: "% supply" },
      { key: "sell0", label: "Max per sell at launch", help: "0 = no cap on sells", type: "pct", numeric: true, min: 0, max: 100, step: 0.001, default: 1, unit: "% supply" },
      { key: "levels", label: "Then, as the market cap grows", help: "from each market cap, the caps change to these", type: "levels", default: "100000:1:0.5;500000:0.5:0.25;1000000:0.25:0.1" },
    ],
    summary: (p) => slidecapSummary(p),
    toInitArgs: () => [], // not used: see app/lib/node/slidecap.ts
  },
  {
    id: "capbeacon",
    name: "Beacon",
    tagline: "Trade it freely. When its market cap hits the target, its Entangled token unlocks.",
    blurb:
      "No cap and no gate. On every trade the Beacon's hook reads its own Meteora pool and remembers the highest market cap it has reached. Pair it with an Entangled token, and that token unlocks for good the first time the Beacon's market cap reaches the target you set.",
    program: "8h3iUcxwcCb2YJW99HbTmPohhitPsE94dHDuEAhwBJ7U",
    statePrefix: "gate",
    preview: "gate",
    accent: "a",
    family: "Reactive",
    meteora: "safe",
    capgate: "beacon",
    params: [],
    toInitArgs: () => [], // not used: see app/lib/node/capgate.ts
  },
  {
    id: "capentangled",
    name: "Entangled",
    tagline: "Locked until its Beacon token reaches a market cap you choose.",
    blurb:
      "Every transfer is refused until its Beacon token's market cap reaches your target, for example $20,000. The hook reads the Beacon's Meteora pool directly, and the first trade after the target is hit unlocks this token for good, even if the Beacon falls back later. The target is set in dollars and fixed in SOL at launch.",
    program: "8h3iUcxwcCb2YJW99HbTmPohhitPsE94dHDuEAhwBJ7U",
    statePrefix: "gate",
    preview: "gate",
    accent: "b",
    family: "Reactive",
    meteora: "safe",
    capgate: "entangled",
    needsPartner: "one",
    partnerHint: "The partner must be a Hooked Beacon token: this one unlocks when that Beacon's market cap reaches your target.",
    partnerFamily: ["capbeacon"],
    couplingKeys: ["partner"],
    params: [
      { key: "partner", label: "Beacon token mint", type: "pubkey", default: "" },
      { key: "targetUsd", label: "Unlocks when the Beacon's market cap reaches", type: "range", min: 1000, max: 10_000_000, step: 1000, default: 20_000, unit: "USD" },
    ],
    summary: (p) => `This token unlocks the first time its Beacon's market cap reaches $${num(p.targetUsd, 20000).toLocaleString("en-US")}, and stays unlocked after that. The target is converted to SOL at launch.`,
    toInitArgs: () => [], // not used: see app/lib/node/capgate.ts
  },
  {
    id: "airdrop",
    name: "Buyer rewards",
    tagline: "Every buy earns the buyer tokens or NFTs from a vault you fill.",
    blurb:
      "Fill a vault with any token or with NFTs. Every qualifying buy records a reward for the buyer inside the transfer, and the buyer collects it on Hooked: tokens, or one NFT per reward. It works for every buyer, even ones who have never held that token. Buys only earn while the vault can cover them, so every reward is covered. You can withdraw anything that isn't already owed to buyers, and anyone can top the vault up.",
    program: "3MNVGyhzq5iLN2ZAnkSnBdwqEomtdQ9vt7qS6nheauok",
    statePrefix: "cfg",
    preview: "emission",
    accent: "b",
    family: "Rewards",
    meteora: "client",
    airdrop: true,
    params: [
      { key: "minBuy", label: "Minimum buy to earn", help: "smaller buys earn nothing, so dust buys can't drain the vault", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
      { key: "poolSol", label: "Reward-record rent pool", help: "pays the one-time rent for each new buyer's reward record (about 0.0011 SOL each); you can withdraw what's unused", type: "range", min: 0.01, max: 5, step: 0.01, default: 0.05, unit: "SOL" },
    ],
    toInitArgs: () => [], // not used: see app/lib/node/airdrop.ts
  },
  {
    id: "breathing",
    name: "Breathing cap",
    tagline: "The buy cap rises and falls on the clock, forever.",
    blurb:
      "An oscillator inside the hook swings the per-buy cap up and down on a fixed cycle: wide open at the peaks, tight at the troughs, then open again, for the life of the token with nothing to crank. You choose the cycle length, the base cap and how far it swings. Sells and wallet-to-wallet sends are never capped, and your own wallet can buy any size.",
    program: "C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk",
    statePrefix: "ph",
    preview: "breathing",
    accent: "a",
    family: "Dynamics",
    meteora: "safe",
    physics: "breathing",
    params: [
      { key: "period", label: "Cycle length", help: "one full breath, open to tight and back", type: "range", min: 30, max: 3600, step: 10, default: 300, unit: "seconds" },
      { key: "base", label: "Base cap", help: "the cap halfway through a breath", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply" },
      { key: "swing", label: "Swing", help: "how far above and below the base it breathes", type: "range", min: 10, max: 100, step: 5, default: 60, unit: "% of the base" },
      { key: "floor", label: "Floor", help: "the cap never drops below this", type: "pct", min: 0.01, max: 5, step: 0.01, default: 0.1, unit: "% supply" },
    ],
    summary: (p) => {
      const base = num(p.base, 1), sw = num(p.swing, 60) / 100, per = num(p.period, 300);
      return `The most one buy can take swings between ${Math.max(num(p.floor, 0.1), +(base * (1 - sw)).toFixed(3))}% and ${+(base * (1 + sw)).toFixed(3)}% of supply, over and over, one full breath every ${per >= 120 ? `${+(per / 60).toFixed(1)} minutes` : `${per} seconds`}. Sells and sends are never capped and your wallet is exempt.`;
    },
    toInitArgs: () => [], // not used: see app/lib/node/physics.ts
  },
  {
    id: "momentum",
    name: "Momentum",
    tagline: "Buying revs it up; a quiet market lets it ring down.",
    blurb:
      "A damped oscillator that starts at rest. Every buy kicks it, in proportion to its size, and the cap swings up with it, so a run of buying opens the door to bigger buys. Then it swings back below the base before settling, and damping bleeds the energy off when trading stalls. Sells and wallet-to-wallet sends are never capped, and your own wallet can buy any size.",
    program: "C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk",
    statePrefix: "ph",
    preview: "momentum",
    accent: "a",
    family: "Dynamics",
    meteora: "safe",
    physics: "momentum",
    params: [
      { key: "period", label: "Natural period", help: "one full swing", type: "range", min: 20, max: 1200, step: 10, default: 120, unit: "seconds" },
      { key: "damping", label: "Damping", help: "how fast it settles when trading stops", type: "range", min: 1, max: 40, step: 1, default: 8, unit: "% per second" },
      { key: "kick", label: "Buy energy", help: "how hard each buy kicks it", type: "range", min: 5, max: 100, step: 5, default: 40, unit: "%" },
      { key: "base", label: "Base cap", help: "the most one buy can take when the oscillator is at rest", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply" },
      { key: "floor", label: "Floor", help: "the cap never drops below this", type: "pct", min: 0.01, max: 5, step: 0.01, default: 0.25, unit: "% supply" },
    ],
    summary: (p) => `At rest one buy can take ${num(p.base, 1)}% of supply. Every buy kicks the oscillator, so a run of buying opens room for bigger buys; then it swings back down, never below ${num(p.floor, 0.25)}%, and settles when trading goes quiet. Sells and sends are never capped and your wallet is exempt.`,
    toInitArgs: () => [], // not used: see app/lib/node/physics.ts
  },
  {
    id: "resonance",
    name: "Resonance",
    tagline: "Buy in rhythm and the cap swings wide open.",
    blurb:
      "Momentum tuned for rhythm: a lightly damped oscillator with a natural period you choose. Buys that land in step with it (one every period) pile energy on and swing the cap far wider than the same buys landing at random; on devnet, four buys in rhythm built five times the energy of four off rhythm. A community that buys together, on the beat, unlocks the biggest buys. Sells and wallet-to-wallet sends are never capped, and your own wallet can buy any size.",
    program: "C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk",
    statePrefix: "ph",
    preview: "momentum",
    accent: "a",
    family: "Dynamics",
    meteora: "safe",
    physics: "resonance",
    params: [
      { key: "period", label: "The beat", help: "buy once every this long to resonate", type: "range", min: 20, max: 1200, step: 10, default: 60, unit: "seconds" },
      { key: "damping", label: "Damping", help: "low keeps the energy ringing between beats", type: "range", min: 1, max: 20, step: 1, default: 2, unit: "% per second" },
      { key: "kick", label: "Buy energy", help: "how hard each buy kicks it", type: "range", min: 5, max: 100, step: 5, default: 40, unit: "%" },
      { key: "base", label: "Base cap", help: "the most one buy can take when the oscillator is at rest", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply" },
      { key: "floor", label: "Floor", help: "the cap never drops below this", type: "pct", min: 0.01, max: 5, step: 0.01, default: 0.25, unit: "% supply" },
    ],
    summary: (p) => { const per = num(p.period, 60); return `Buys landing once every ${per >= 120 ? `${+(per / 60).toFixed(1)} minutes` : `${per} seconds`} build on each other and swing the cap wide open; scattered buys mostly cancel out. At rest one buy can take ${num(p.base, 1)}% of supply, never less than ${num(p.floor, 0.25)}%. Sells and sends are never capped and your wallet is exempt.`; },
    toInitArgs: () => [], // not used: see app/lib/node/physics.ts
  },
  {
    id: "coupled",
    name: "Coupled resonator",
    tagline: "Two oscillators inside one token, trading energy in beats.",
    blurb:
      "Two coupled oscillators in the hook. Buys energise the first, which sets the cap; the coupling then pours that energy into the second and back again, so the cap swells, fades as the energy moves away, and swells again: it literally beats. Sells and wallet-to-wallet sends are never capped, and your own wallet can buy any size.",
    program: "C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk",
    statePrefix: "ph",
    preview: "coupled",
    accent: "b",
    family: "Dynamics",
    meteora: "safe",
    physics: "coupled",
    params: [
      { key: "period", label: "Natural period", help: "one swing of each oscillator", type: "range", min: 20, max: 1200, step: 10, default: 180, unit: "seconds" },
      { key: "coupling", label: "Coupling", help: "stronger coupling trades energy faster", type: "range", min: 1, max: 60, step: 1, default: 20, unit: "%" },
      { key: "damping", label: "Damping", help: "how fast it settles when trading stops", type: "range", min: 0, max: 20, step: 1, default: 2, unit: "% per second" },
      { key: "kick", label: "Buy energy", help: "how hard each buy kicks the first oscillator", type: "range", min: 5, max: 100, step: 5, default: 40, unit: "%" },
      { key: "base", label: "Base cap", help: "the most one buy can take when the oscillator is at rest", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply" },
      { key: "floor", label: "Floor", help: "the cap never drops below this", type: "pct", min: 0.01, max: 5, step: 0.01, default: 0.25, unit: "% supply" },
    ],
    summary: (p) => `At rest one buy can take ${num(p.base, 1)}% of supply. Buys kick the first oscillator and the cap swings with it, while the coupling (${num(p.coupling, 20)}%) passes the energy to the second oscillator and back, so the cap swells and fades in beats, never below ${num(p.floor, 0.25)}%. Sells and sends are never capped and your wallet is exempt.`,
    toInitArgs: () => [], // not used: see app/lib/node/physics.ts
  },
  {
    id: "reactive",
    name: "Reactive pair",
    tagline: "Its per-buy cap moves with a partner token's buying and selling.",
    blurb:
      "The per-buy cap loosens as a partner token is accumulated and tightens as it's dumped: cap = base + sensitivity × partner net pressure. A continuous on-chain reaction to another market, enforced inside the swap.",
    program: "BCiJ49rbFS7Lw6QfbxweBQ5a4RVsif12kHBnx4QHBUxM",
    statePrefix: "ps",
    preview: "reactive",
    accent: "b",
    needsPartner: "one",
    partnerHint: "The partner must be another Hooked Reactive pair token: this one reads its buying and selling.",
    partnerFamily: ["reactive"],
    couplingKeys: ["partner"],
    params: [
      { key: "partner", label: "Partner token mint", type: "pubkey", default: "" },
      { key: "base", label: "Base cap", help: "the per-buy cap when the partner is flat", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply per buy" },
      { key: "sens", label: "Sensitivity", help: "how far the cap moves for each 1% of the partner's supply bought (or sold) on net, as a share of the base cap", type: "range", min: 1, max: 100, step: 1, default: 25, unit: "%" },
    ],
    toInitArgs: (p, supply) => {
      const base = pctRaw(num(p.base, 1), supply);
      const unit = pctRaw(1, supply); // 1% of partner supply per step unit
      const step = (base * BigInt(Math.round(num(p.sens, 25) * 100))) / 10_000n;
      return [
        { t: "u8", v: 1 }, // mode 1 = reactive cap (mode 0 = publisher only)
        { t: "u64", v: base },
        { t: "u64", v: step },
        { t: "u64", v: unit },
        { t: "pubkey", v: DBC_POOL_AUTHORITY },
        { t: "pubkey", v: psFeed(p.partner) }, // partner's live feed (state PDA), not the mint
      ];
    },
  },
  {
    id: "entangled",
    name: "Entangled (volume)",
    tagline: "Locked until enough of its Beacon token has changed hands.",
    blurb:
      "Transfers stay frozen until a set amount of a partner Beacon token has changed hands. Buys, sells and wallet transfers of the Beacon all count. Then it unlocks automatically, for good. Launch the two as a pair and trading the Beacon opens this one.",
    program: "5aAXdggDpJBtAfDoFusTp44tj5XpBXbxuCwDqpc17SBb",
    statePrefix: "tw",
    preview: "gate",
    accent: "b",
    needsPartner: "one",
    partnerHint: "The partner must be a Hooked Beacon token: this one unlocks once enough of that Beacon has changed hands.",
    partnerFamily: ["beacon"],
    couplingKeys: ["partner"],
    params: [
      { key: "partner", label: "Partner mint", type: "pubkey", default: "" },
      { key: "threshold", label: "Unlocks after this share of the Beacon changes hands", type: "pct", min: 0.1, max: 100, step: 0.1, default: 5, unit: "% of its supply" },
    ],
    summary: (p) => unlockSummary(num(p.threshold, 5), "This token", "its Beacon's"),
    toInitArgs: (p, supply) => [
      { t: "u8", v: 0 }, // mode 0 = locked until partner metric ≥ threshold
      { t: "u64", v: pctRaw(num(p.threshold, 5), supply) },
      { t: "pubkey", v: twFeed(p.partner) }, // partner twin's volume feed (state PDA)
    ],
  },
  {
    id: "index",
    name: "Weighted index",
    tagline: "Track a weighted basket of other Hooked tokens.",
    blurb:
      "The cap moves with the weighted sum of a basket's net buy pressure — a sector index as a token, with the heavy members moving it hardest. Members must be Hooked reactive-family tokens.",
    program: "GnxyEq4SFFBXLN3ejVmNSFnciDB3ssApXRQs1eTnz2XT",
    statePrefix: "wx",
    preview: "index",
    accent: "a",
    needsPartner: "many",
    partnerHint: "Comma-separated Hooked reactive-family mints. Set weights to make the heavier members move the cap harder.",
    partnerFamily: ["reactive"],
    couplingKeys: ["members"],
    params: [
      { key: "members", label: "Basket mints", type: "pubkeyList", help: "comma-separated", default: "" },
      { key: "weights", label: "Member weights", type: "numList", help: "comma-separated, parallel to the mints; blank = equal", default: "" },
      { key: "base", label: "Base cap", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply / buy" },
      { key: "sens", label: "Sensitivity", type: "range", min: 1, max: 100, step: 1, default: 25, unit: "%" },
    ],
    toInitArgs: (p, supply) => {
      const members = pkList(p.members);
      const w = numList(p.weights); // parallel to members; missing entries default to weight 1
      const base = pctRaw(num(p.base, 1), supply);
      const step = (base * BigInt(Math.round(num(p.sens, 25) * 100))) / 10_000n;
      return [
        { t: "u8", v: 1 },
        { t: "u64", v: base },
        { t: "u64", v: step },
        { t: "u64", v: pctRaw(1, supply) },
        { t: "pubkey", v: DBC_POOL_AUTHORITY },
        { t: "vec_pubkey", v: members.map((m) => psFeed(m)) }, // each member's live feed (state PDA)
        { t: "vec_u64", v: members.map((_, i) => BigInt(w[i] ?? 1)) }, // per-member weights (default equal)
      ];
    },
  },
  {
    id: "inverse",
    name: "Inverse pair",
    tagline: "Chokes as its rival pumps — anti-correlated rotation.",
    blurb:
      "The mirror of the reactive pair: the cap tightens as a rival token runs hot and relaxes as it cools, down to a floor. Two inverse-coupled tokens naturally rotate capital between themselves.",
    program: "ATtqAHQiSNx3X1U316uW3aUm6hKvJQtEXdQvrZfCZouH",
    statePrefix: "iv",
    preview: "inverse",
    accent: "b",
    needsPartner: "one",
    partnerHint: "The rival must be another Hooked reactive-family token.",
    partnerFamily: ["reactive"],
    couplingKeys: ["partner"],
    params: [
      { key: "partner", label: "Rival mint", type: "pubkey", default: "" },
      { key: "base", label: "Cap when rival is cool", type: "pct", min: 0.1, max: 10, step: 0.1, default: 2, unit: "% supply / buy" },
      { key: "sens", label: "Sensitivity", type: "range", min: 1, max: 100, step: 1, default: 25, unit: "%" },
      { key: "floor", label: "Cap when rival is hot", type: "pct", min: 0, max: 5, step: 0.05, default: 0.1, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => {
      const base = pctRaw(num(p.base, 2), supply);
      const step = (base * BigInt(Math.round(num(p.sens, 25) * 100))) / 10_000n;
      return [
        { t: "u8", v: 1 },
        { t: "u64", v: base },
        { t: "u64", v: step },
        { t: "u64", v: pctRaw(1, supply) },
        { t: "u64", v: pctRaw(num(p.floor, 0.1), supply) },
        { t: "pubkey", v: DBC_POOL_AUTHORITY },
        { t: "pubkey", v: psFeed(p.partner) }, // partner's live feed (state PDA), not the mint
      ];
    },
  },
  {
    id: "guard",
    tier: "core",
    name: "Trade guard",
    tagline: "No single trade can move more than a set share of supply.",
    blurb:
      "Every buy, sell and transfer is capped at the same share of supply, for example 0.5%. Anything bigger is refused inside the swap, so no whale can grab or dump a big bag in one trade.",
    program: "9Kvwjjf2f9jP64JuC5AHfCQdxynHV1e678kfZCpiJ31z",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    params: [
      { key: "maxTrade", label: "Max per trade", type: "pct", min: 0.05, max: 10, step: 0.05, default: 0.5, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 1 }, // vhook mode 1 = MaxAmount per transfer (DBC-safe; mode 3 max-holding would block sells to the pool vault)
      { t: "u64", v: pctRaw(num(p.maxTrade, 0.5), supply) },
      { t: "pubkey", v: PublicKey.default },
    ],
  },

  // ── Wave 1: emission economy (emit + distrib — create a reward side token) ──
  {
    id: "halving",
    tier: "core",
    name: "Halving mining",
    tagline: "Every buy mines a reward token — on a halving schedule.",
    blurb:
      "On launch, Hooked mints a brand-new reward token and creates a vault for it that only your token's hook can mint into. Every trade mints the reward to that vault — and the amount halves each period, decaying Bitcoin-style. Holders stake the coin on the token's page to claim their pro-rata share of the vault; the amount is derived from your mint, not a destination you pick. Fully on-chain, mint-keyed, Meteora-safe.",
    program: "H8ceAVapJUohrhs2pdy39LY3xqgKsR9B5s2FWT2t2tjo",
    statePrefix: "em",
    preview: "emission",
    accent: "a",
    family: "Emission",
    meteora: "verified",
    sideToken: "emit",
    stakePool: true,
    params: [
      { key: "perTrade", label: "Reward per trade (at launch)", type: "range", min: 1, max: 1000, step: 1, default: 100, unit: "reward tokens" },
      { key: "halvingHours", label: "Reward halves every", type: "range", min: 1, max: 168, step: 1, default: 24, unit: "hours" },
    ],
    toInitArgs: (p, _s, ctx) => [
      { t: "u8", v: 0 }, // mode 0 Halving
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.perTrade, 100))) * rewardUnit(p) },
      { t: "i64", v: BigInt(Math.round(num(p.halvingHours, 24) * 3600)) }, // seconds on-chain
      { t: "pubkey", v: ctx?.sideMint ?? PublicKey.default },
      { t: "pubkey", v: ctx?.vault ?? PublicKey.default },
      { t: "pubkey", v: ctx?.stakeVault ?? PublicKey.default },
      { t: "u64", v: 1n }, // jackpot_mult unused for halving
    ],
  },
  {
    id: "dumpcatcher",
    name: "Dump-catcher",
    tagline: "Every sell burns a slice of the reward token.",
    blurb:
      "On each sell (tokens flowing back to the pool), the hook burns a percentage of the reward-token vault in-flight — a fully on-chain deflationary response to dumping, no crank, no keeper.",
    program: "H8ceAVapJUohrhs2pdy39LY3xqgKsR9B5s2FWT2t2tjo",
    statePrefix: "em",
    preview: "emission",
    accent: "b",
    family: "Emission",
    meteora: "safe",
    sideToken: "emit",
    params: [
      { key: "burnPct", label: "Burn on sell", type: "range", min: 0.01, max: 5, step: 0.01, default: 1, unit: "% of each sell" },
    ],
    toInitArgs: (p, _s, ctx) => [
      { t: "u8", v: 1 }, // mode 1 ReactBurn
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.burnPct, 1) * 100)) }, // basis points on-chain
      { t: "i64", v: 1n },
      { t: "pubkey", v: ctx?.sideMint ?? PublicKey.default },
      { t: "pubkey", v: ctx?.vault ?? PublicKey.default },
      { t: "pubkey", v: PublicKey.default }, // no stake vault (burn behavior)
      { t: "u64", v: 1n }, // jackpot_mult unused for dumpcatcher
    ],
  },
  {
    id: "jackpot",
    tier: "core",
    name: "Jackpot",
    tagline: "A 1-in-N trade mints a big reward payout — you set the odds and the size.",
    blurb:
      "On-chain randomness (SlotHashes) rolls on every trade: one in every N trades mints your chosen multiple of the base reward to the token's reward vault, the rest mint 1×. You set both the odds (1 in N) and the payout (×). Holders stake the coin to claim their pro-rata share of the vault — a trustless lottery driven by trading itself.",
    program: "H8ceAVapJUohrhs2pdy39LY3xqgKsR9B5s2FWT2t2tjo",
    statePrefix: "em",
    preview: "emission",
    accent: "a",
    family: "Emission",
    meteora: "safe",
    sideToken: "emit",
    stakePool: true,
    params: [
      { key: "perTrade", label: "Base reward per trade", type: "range", min: 1, max: 1000, step: 1, default: 50, unit: "reward tokens" },
      { key: "odds", label: "Jackpot odds (1 in N)", type: "range", min: 2, max: 1000, step: 1, default: 10, unit: "trades" },
      { key: "mult", label: "Jackpot payout", type: "range", min: 2, max: 100, step: 1, default: 10, unit: "× the base reward" },
    ],
    toInitArgs: (p, _s, ctx) => [
      { t: "u8", v: 2 }, // mode 2 RngBonus
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.perTrade, 50))) * rewardUnit(p) },
      { t: "i64", v: BigInt(Math.round(num(p.odds, 10))) }, // period field reused as the 1-in-N odds denominator
      { t: "pubkey", v: ctx?.sideMint ?? PublicKey.default },
      { t: "pubkey", v: ctx?.vault ?? PublicKey.default },
      { t: "pubkey", v: ctx?.stakeVault ?? PublicKey.default },
      { t: "u64", v: BigInt(Math.round(num(p.mult, 10))) }, // jackpot payout multiplier
    ],
  },
  {
    id: "buyburn",
    tier: "core",
    name: "Buyback & burn",
    tagline: "Trading fills a reward vault; a public burn keeps it scarce.",
    blurb:
      "Every trade mints a reward token to a per-mint vault. Anyone can trigger a permissionless burn that torches everything above a floor — a credible, on-chain buy-and-burn enforced by the chain, not a team's promise.",
    program: "FiKwxPjoNPx1W4YiBTAtgjvuWnyDpy8A3SFkA2aPiL1U",
    statePrefix: "ds",
    preview: "emission",
    accent: "b",
    family: "Rewards",
    meteora: "verified",
    sideToken: "distrib",
    postLaunch: "burn",
    params: [
      { key: "perTrade", label: "Reward per trade", type: "range", min: 1, max: 1000, step: 1, default: 100, unit: "reward tokens" },
      { key: "floor", label: "Keep floor", type: "range", min: 0, max: 1000, step: 10, default: 0, unit: "reward tokens" },
    ],
    toInitArgs: (p, _s, ctx) => [
      { t: "u8", v: 1 }, // mode 1 scarcity burn
      { t: "u64", v: BigInt(Math.round(num(p.perTrade, 100))) * rewardUnit(p) },
      { t: "u64", v: BigInt(Math.round(num(p.floor, 0))) * rewardUnit(p) },
      { t: "pubkey", v: ctx?.sideMint ?? PublicKey.default },
      { t: "pubkey", v: ctx?.vault ?? PublicKey.default },
      { t: "pubkey", v: ctx?.stakeMint ?? PublicKey.default },
      { t: "pubkey", v: ctx?.stakeVault ?? PublicKey.default },
    ],
  },

  // ── Wave 2: self-modifying caps (evolve) + anti-sniper (lhook) ──
  {
    id: "chapters",
    name: "Chapters",
    tagline: "A max per wallet that doubles every time enough volume trades.",
    blurb:
      "Each wallet can hold at most the current cap. The cap starts small and doubles every time the total volume traded crosses another chapter, for example every 10,000,000 tokens. Early buyers get a fair, small allowance; the token opens up as it earns real volume. Selling back into the pool always works.",
    program: "A7m1Pw8Kj8YfSEjZe3SEHAzeFE3xZPTmH4XqhLqRhQsc",
    statePrefix: "ev",
    preview: "ratchet",
    accent: "a",
    family: "Caps",
    meteora: "verified",
    params: [
      { key: "capPct", label: "Starting max per wallet", type: "pct", min: 0.1, max: 5, step: 0.1, default: 1, unit: "% supply" },
      { key: "stepTokens", label: "Volume per chapter", help: "the cap doubles every time this many more tokens have traded", type: "range", min: 1_000_000, max: 100_000_000, step: 1_000_000, default: 10_000_000, unit: "tokens traded" },
    ],
    toInitArgs: (p) => [
      { t: "u8", v: 0 }, // mode 0 EvolvingCap
      { t: "u16", v: Math.round(num(p.capPct, 1) * 100) }, // basis points on-chain
      { t: "u64", v: BigInt(Math.round(num(p.stepTokens, 10_000_000))) * tokenUnit(p) },
    ],
  },
  {
    id: "vise",
    name: "The Vise",
    tagline: "The cap tightens over time toward a floor.",
    blurb:
      "The max trade size shrinks by 1 basis point every N seconds, ratcheting down toward a floor — a clock-driven squeeze that steadily reduces how much any single trade can move, purely on-chain.",
    program: "A7m1Pw8Kj8YfSEjZe3SEHAzeFE3xZPTmH4XqhLqRhQsc",
    statePrefix: "ev",
    preview: "ratchet",
    accent: "b",
    family: "Caps",
    meteora: "verified",
    params: [
      { key: "capPct", label: "Starting cap", type: "pct", min: 0.1, max: 5, step: 0.1, default: 2, unit: "% supply" },
      { key: "period", label: "Cap shrinks by 0.01% of supply every", type: "range", min: 10, max: 3600, step: 10, default: 300, unit: "seconds" },
    ],
    toInitArgs: (p) => [
      { t: "u8", v: 1 }, // mode 1 TimeRatchet
      { t: "u16", v: Math.round(num(p.capPct, 2) * 100) }, // basis points on-chain
      { t: "u64", v: BigInt(Math.round(num(p.period, 300))) },
    ],
  },
  {
    id: "antisniper",
    tier: "core",
    name: "Anti-bundle",
    tagline: "Only a few trades per block, so bundlers can't sweep the launch.",
    blurb:
      "The hook counts trades in each Solana block and refuses any past your limit. A bundler packing many buys into one block gets the first few at most, so nobody can buy up the launch in a single shot.",
    program: "AsqN4BA2cGmzbajL5rdg8rmfAsWs2K4TBS7Eqa8eLaY8",
    statePrefix: "lim",
    preview: "ratelimit",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    params: [
      { key: "maxPerSlot", label: "Max trades per block", type: "range", min: 1, max: 20, step: 1, default: 3, unit: "trades" },
    ],
    toInitArgs: (p) => [{ t: "u32", v: Math.round(num(p.maxPerSlot, 3)) }],
  },

  // ── Wave 3: oracle-gated, wired to a real Pyth SOL/USD feed via the Hooked bridge ──
  {
    id: "oraclefloor",
    name: "Price floor",
    tagline: "Halt trading when SOL/USD falls below your floor.",
    blurb:
      "Reads a live Pyth SOL/USD price — bridged on-chain by Hooked's keeper — and rejects every transfer while the price sits under your floor. A hard, market-conditional guard enforced in the swap itself.",
    program: "Gi1RsSKvyKvGWcFC3ytboMwvgrbq57LQZcxvx9Y6WY1L",
    statePrefix: "ocfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "safe",
    params: [
      { key: "minPrice", label: "SOL/USD floor", type: "range", min: 10, max: 500, step: 5, default: 50, unit: "$" },
    ],
    // ohook stores the floor in the same integer units the keeper pushes (USD cents).
    toInitArgs: (p) => [{ t: "u64", v: BigInt(Math.round(num(p.minPrice, 100) * 100)) }],
  },

  // ── Lazy-slot dividends + vesting (drip, Batch 55): the hook creates each buyer's slot
  //    inside the swap on first receipt, so per-holder rewards/locks work on a live bonding
  //    curve. Owner-derived → client-mode (traded via Hooked's own swap route). ──
  {
    id: "dividends",
    name: "SOL dividends",
    tagline: "Every buy pays a SOL dividend to the buyer — claimable, real yield.",
    blurb:
      "You pre-fund a SOL pool at launch. On every buy, the hook opens the buyer's claim slot (inside the swap, no pre-registration) and drips a fixed SOL dividend into it from the pool. Holders claim their accrued SOL any time. Real, on-chain yield paid in SOL — not a minted token — funded by you and enforced by the swap. Because the slot is keyed on the buyer, trading goes through Hooked's swap route. Proven live on Meteora.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "emission",
    accent: "b",
    family: "Rewards",
    meteora: "client",
    initPoolSeed: "pool",
    postLaunch: "claim",
    params: [
      { key: "dividendSol", label: "Dividend per buy", help: "SOL paid into each buyer's claim slot on every buy", type: "range", min: 0.0005, max: 0.05, step: 0.0005, default: 0.002, unit: "SOL" },
      { key: "poolSol", label: "Dividend pool", help: "total SOL you pre-fund at launch — dividends stop paying once it runs dry (slot rent also comes from here)", type: "range", min: 0.1, max: 20, step: 0.1, default: 1, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", help: "anti-drain: a buy must be at least this big to open a claim slot, so dust spam can't burn the pool", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 0 }, // mode 0 = SOL dividends
      { t: "u64", v: BigInt(Math.round(num(p.dividendSol, 0.002) * 1e9)) }, // dividend lamports/buy
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) }, // min_new_slot
      { t: "u64", v: 0n }, // cliff (unused)
      { t: "u64", v: 1n }, // period (unused, >=1)
      { t: "u64", v: 0n }, // bps_per_period (unused)
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 1) * 1e9)) }, // prefund the pool
      { t: "pubkey", v: PublicKey.default }, // side_mint (unused for SOL dividends)
    ],
  },
  {
    id: "tokendividends",
    name: "Token dividends",
    tagline: "Every buy pays the buyer your reward token — claimable, per holder.",
    blurb:
      "Like SOL dividends, but paid in a brand-new reward token you name at launch. Every buy accrues a fixed amount of the reward token to the buyer's slot (created inside the swap, no pre-registration); holders mint what they're owed any time. The reward is a separate classic-SPL token minted by your token's hook — the coin itself is never touched. Per-buyer, on-chain, funded by emission rather than a pool. Traded through Hooked's swap route.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "emission",
    accent: "a",
    family: "Rewards",
    meteora: "client",
    initPoolSeed: "pool",
    sideToken: "emit", // launch flow brands a classic-SPL mint + hands authority to drip's ["auth"]
    postLaunch: "claimToken",
    params: [
      { key: "perBuy", label: "Reward per buy", help: "how many reward tokens each buy pays the buyer", type: "range", min: 1, max: 100000, step: 1, default: 1000, unit: "reward tokens" },
      { key: "poolSol", label: "Slot-rent pool", help: "pre-funds the per-wallet slots created on each first buy (~0.0014 SOL each)", type: "range", min: 0.1, max: 10, step: 0.1, default: 0.5, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", help: "anti-drain: a buy must be at least this big to open a slot", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    toInitArgs: (p, supply, ctx) => [
      { t: "u8", v: 2 }, // mode 2 = token dividends
      { t: "u64", v: BigInt(Math.round(num(p.perBuy, 1000))) * rewardUnit(p) }, // reward tokens/buy
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) }, // min_new_slot
      { t: "u64", v: 0n }, // cliff (unused)
      { t: "u64", v: 1n }, // period (unused)
      { t: "u64", v: 0n }, // bps_per_period (unused)
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.5) * 1e9)) }, // prefund the slot-rent pool
      { t: "pubkey", v: ctx?.sideMint ?? PublicKey.default }, // the branded reward token
    ],
  },
  {
    id: "vesting",
    name: "Holder vesting",
    tagline: "Each wallet unlocks its bag on its own clock — anti-dump by construction.",
    blurb:
      "Every wallet's tokens unlock on a schedule that starts the moment it first buys: nothing during the cliff, then a fixed percentage every period you choose, from hourly to weekly. A wallet can only sell what it has unlocked — the hook vetoes any sell beyond its own vested share, per holder, enforced in the swap. No team multisig, no snapshot: the lock lives in the token. Traded through Hooked's swap route. Proven live on Meteora.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "ratchet",
    accent: "a",
    family: "Caps",
    meteora: "client",
    initPoolSeed: "pool",
    presaleCutoff: true, // with an early-buyers window, the launch flow turns it into an absolute slot
    summary: (p) => (num(p.presaleHours, 0) > 0
      ? `Only wallets that first buy in the first ${num(p.presaleHours, 0)} hours vest; later buyers are free. ${vestingSummary(p, "Early wallets")}`
      : vestingSummary(p, "Wallets")) + ` ${slotPoolLine(num(p.poolSol, 0.5))}`,
    params: [
      { key: "presaleHours", label: "Only vest early buyers", help: "0 = every wallet vests. Otherwise only wallets whose first buy lands within this many hours of launch vest; later buyers are free", type: "range", min: 0, max: 168, step: 1, default: 0, unit: "hours" },
      { key: "cliffHours", label: "Cliff", help: "no tokens unlock until this long after a wallet's first buy", type: "range", min: 0, max: 168, step: 1, default: 24, unit: "hours" },
      { key: "unlockPct", label: "Unlock each period", help: "how much of a wallet's bag unlocks every period after the cliff", type: "range", min: 0.1, max: 100, step: 0.1, default: 10, unit: "%" },
      { key: "unlockEveryHours", label: "Unlock period", help: "how often an unlock happens: 1 = hourly, 24 = daily, 168 = weekly", type: "range", min: 1, max: 168, step: 1, default: 24, unit: "hours" },
      { key: "poolSol", label: "Slot-rent pool", help: "pre-funds the per-wallet slots created on each first buy (~0.0014 SOL each)", type: "range", min: 0.1, max: 10, step: 0.1, default: 0.5, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", help: "anti-drain: a buy must be at least this big to open a slot", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    // slots ≈ 0.4s → 1 hour ≈ 9000 slots, 1 day ≈ 216000 slots.
    // mode 1 = every wallet vests; mode 5 = only wallets whose first buy is before the cutoff slot
    // (same program path, one extra check). The cutoff rides in the dividend field.
    toInitArgs: (p, supply, ctx) => [
      { t: "u8", v: num(p.presaleHours, 0) > 0 ? 5 : 1 },
      { t: "u64", v: num(p.presaleHours, 0) > 0 ? (ctx?.cutoffSlot ?? 0n) : 0n },
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) }, // min_new_slot
      { t: "u64", v: BigInt(Math.round(num(p.cliffHours, 24) * 9000)) }, // cliff_slots
      { t: "u64", v: BigInt(unlockHours(p) * SLOTS_PER_HOUR) }, // period_slots
      { t: "u64", v: BigInt(Math.min(10000, Math.max(1, Math.round(unlockPct(p) * 100)))) }, // bps per period
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.5) * 1e9)) }, // prefund the slot-rent pool
      { t: "pubkey", v: PublicKey.default }, // side_mint (unused for vesting)
    ],
  },
  {
    id: "realyield",
    name: "Dividends",
    tagline: "Every buy pays the buyer a token you choose, straight to their wallet.",
    blurb:
      "Pick any standard SPL token you hold (USDC, a memecoin, a whole-number collectible token) and fund a vault with it at launch. On every buy, the hook sends a fixed amount from the vault to the buyer's wallet, where it just shows up, with nothing to claim. The limits: the buyer must already hold that token (a wallet without it is skipped, the buy still goes through), the vault is finite, and it pays one token, so a vault of different NFTs can't be handed out one per buy. Anyone can top the vault up. Trades through the Hooked route.",
    program: "6nxb6Q2v3LYLqwyxeCXL9aQd58omqRZ4sTHjswC4SV3L",
    statePrefix: "cfg",
    preview: "emission",
    accent: "b",
    family: "Rewards",
    meteora: "client",
    payoutTreasury: true,
    params: [
      { key: "rewardMint", label: "Reward token mint", help: "the existing token buyers are paid in (e.g. the USDC mint)", type: "pubkey", default: "", required: true },
      { key: "rewardDecimals", label: "Reward token decimals", help: "USDC = 6; match your reward token", type: "range", min: 0, max: 9, step: 1, default: 6, unit: "decimals" },
      { key: "dripAmount", label: "Reward per buy", help: "how many reward tokens each buy pays (in whole tokens)", type: "range", min: 0.01, max: 100, step: 0.01, default: 1, unit: "reward tokens" },
      { key: "fund", label: "Treasury funding", help: "how many reward tokens to move into the treasury at launch (from your wallet)", type: "range", min: 1, max: 100000, step: 1, default: 1000, unit: "reward tokens" },
    ],
    toInitArgs: (p, _s, ctx) => {
      const dec = Math.round(num(p.rewardDecimals, 6));
      return [
        { t: "u64", v: BigInt(Math.round(num(p.dripAmount, 1) * 10 ** dec)) }, // drip amount (raw)
        { t: "pubkey", v: p.rewardMint ? new PublicKey(String(p.rewardMint)) : PublicKey.default },
        { t: "pubkey", v: ctx?.payoutTreasury ?? PublicKey.default }, // per-mint treasury ATA
        { t: "pubkey", v: DBC_POOL_AUTHORITY },
      ];
    },
  },
  {
    id: "tieredmembership",
    name: "Tiered membership",
    tagline: "Hold more of the members' token, buy more at once.",
    blurb:
      "A membership ladder instead of a turnstile. Wallets still need your gate token to receive this one, but now the amount they hold sets how much they can buy in a single trade: a small holding gets a small limit, the top threshold lifts the limit entirely. One token, three rungs, checked inside every trade. The limit is per trade — this hook keeps no running per-wallet total, so it doesn't pretend to enforce one. Traded through Hooked's route.",
    program: "5M6KxRdyf3Vkw27prDB3KHF4A2xGPvTmjA2DK3abLo4r",
    statePrefix: "du",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "client",
    initIx: "initialize_tiered",
    initPoolSeed: "dutier",
    params: [
      { key: "gateMint", label: "Membership token mint", help: "wallets must hold this token to receive yours; how much they hold sets their tier", type: "pubkey", default: "", required: true },
      { key: "duesSol", label: "Dues per trade", help: "set to the minimum for a pure ladder with no fee", type: "range", min: 0.0005, max: 0.5, step: 0.0005, default: 0.0005, unit: "SOL" },
      { key: "tier1Hold", label: "Bronze: hold at least", type: "range", min: 1, max: 100000, step: 1, default: 1000, unit: "membership tokens" },
      { key: "tier1Cap", label: "Bronze buy limit", type: "pct", min: 0.001, max: 5, step: 0.001, default: 0.05, unit: "% supply" },
      { key: "tier2Hold", label: "Silver: hold at least", type: "range", min: 1, max: 1000000, step: 1, default: 10000, unit: "membership tokens" },
      { key: "tier2Cap", label: "Silver buy limit", type: "pct", min: 0.001, max: 10, step: 0.001, default: 0.5, unit: "% supply" },
      { key: "tier3Hold", label: "Gold: hold at least", help: "at this holding the buy limit comes off entirely", type: "range", min: 1, max: 10000000, step: 1, default: 100000, unit: "membership tokens" },
    ],
    toInitArgs: (p, supply, ctx) => [
      { t: "pubkey", v: p.gateMint ? new PublicKey(String(p.gateMint)) : PublicKey.default },
      { t: "u64", v: BigInt(Math.round(num(p.duesSol, 0.0005) * 1e9)) },
      { t: "pubkey", v: ctx?.creator ?? PublicKey.default },
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      // thresholds [u64; 3] — gate-token balances, ascending. Gate tokens are assumed 6dp,
      // matching everything Hooked itself launches.
      { t: "u64", v: BigInt(Math.round(num(p.tier1Hold, 1000) * 1e6)) },
      { t: "u64", v: BigInt(Math.round(num(p.tier2Hold, 10000) * 1e6)) },
      { t: "u64", v: BigInt(Math.round(num(p.tier3Hold, 100000) * 1e6)) },
      // caps [u64; 3] — most receivable per transfer; 0 on the top rung means no cap.
      { t: "u64", v: pctRaw(num(p.tier1Cap, 0.05), supply) },
      { t: "u64", v: pctRaw(num(p.tier2Cap, 0.5), supply) },
      { t: "u64", v: 0n },
    ],
  },

  // ── Treasuries the token itself governs (treas). The hook keeps the only numbers that
  //    decide when the money moves; there is no instruction that pays anyone else. ──
  {
    id: "holdercap",
    name: "Growing holder cap",
    tagline: "Only N wallets can hold it — and N grows on a clock.",
    blurb:
      "The token opens with a fixed number of seats and widens on a schedule you set: so many wallets at launch, a few more every period, up to a ceiling. A wallet takes a seat the moment its balance goes from zero to non-zero, so buying more once you're in is never gated — and a wallet that sells out completely gives its seat straight back to whoever's next. The cap is on wallets, not on people: every extra wallet costs slot rent and a real minimum buy, which is friction, not a guarantee. And it limits how many hold, not how much any one of them holds. Traded through Hooked's route.",
    program: "B2YVN1bWc95pSDBcZTpKgaH3v2JbmNKWRE5rSYNQ1m2x",
    statePrefix: "tr",
    preview: "gate",
    accent: "a",
    family: "Caps",
    meteora: "client",
    initIx: "initialize_capped",
    initPoolSeed: "trpool",
    initVaultSeed: "trcap",
    params: [
      { key: "startHolders", label: "Seats at launch", type: "range", min: 1, max: 500, step: 1, default: 25, unit: "wallets" },
      { key: "addPerPeriod", label: "Seats added each period", type: "range", min: 0, max: 200, step: 1, default: 10, unit: "wallets" },
      { key: "periodHours", label: "How often seats open", type: "range", min: 0.25, max: 168, step: 0.25, default: 6, unit: "hours" },
      { key: "maxHolders", label: "Ceiling", help: "the cap stops growing here; set to the maximum for no ceiling", type: "range", min: 0, max: 100000, step: 25, default: 1000, unit: "wallets" },
      { key: "poolSol", label: "Slot rent pool", help: "pays the rent for each seated wallet's ledger (~0.0012 SOL each)", type: "range", min: 0.05, max: 10, step: 0.05, default: 0.3, unit: "SOL" },
      { key: "minBuy", label: "Minimum first buy", help: "anti-spam: a wallet must buy at least this much to take a seat", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.02, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: pctRaw(num(p.minBuy, 0.02), supply) },
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.startHolders, 25)))) },
      { t: "u64", v: BigInt(Math.max(0, Math.round(num(p.addPerPeriod, 10)))) },
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.periodHours, 6) * 9_000))) }, // ~400ms slots
      { t: "u64", v: BigInt(Math.max(0, Math.round(num(p.maxHolders, 1000)))) },       // 0 = no ceiling
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.3) * 1e9)) },
    ],
  },
  {
    id: "milestonetreasury",
    name: "Milestone treasury",
    tagline: "Locked money that only unlocks as the holder base grows.",
    blurb:
      "\"We'll donate as we grow\" turned into something the chain does on its own. You lock SOL at launch and set holder-count milestones; each crossing frees one tranche to a beneficiary address fixed at launch. The hook counts distinct holders rather than volume on purpose — one wallet can wash-trade volume in a loop, but every new holder costs a real minimum buy and its own slot rent. Releases are permissionless: you can't withhold a tranche and you can't pull one forward.",
    program: "B2YVN1bWc95pSDBcZTpKgaH3v2JbmNKWRE5rSYNQ1m2x",
    statePrefix: "tr",
    preview: "gate",
    accent: "a",
    family: "Rewards",
    meteora: "client",
    initPoolSeed: "trpool",
    initVaultSeed: "trvault",
    params: [
      { key: "treasurySol", label: "Treasury to lock", type: "range", min: 0.1, max: 50, step: 0.1, default: 1, unit: "SOL" },
      { key: "m1", label: "Milestone 1", type: "range", min: 1, max: 500, step: 1, default: 10, unit: "holders" },
      { key: "m2", label: "Milestone 2", type: "range", min: 1, max: 2000, step: 1, default: 50, unit: "holders" },
      { key: "m3", label: "Milestone 3", type: "range", min: 1, max: 10000, step: 1, default: 250, unit: "holders" },
      { key: "beneficiary", label: "Beneficiary", help: "where each tranche goes — fixed at launch and never changeable; leave blank to send it to yourself", type: "pubkey", default: "" },
      { key: "poolSol", label: "Slot rent pool", help: "pays the rent for each new holder's counter (~0.0012 SOL each)", type: "range", min: 0.05, max: 10, step: 0.05, default: 0.3, unit: "SOL" },
      { key: "minBuy", label: "Minimum first buy", help: "anti-spam: a wallet must buy at least this much to count as a holder", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.02, unit: "% supply" },
    ],
    toInitArgs: (p, supply, ctx) => [
      { t: "u8", v: 0 },
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "pubkey", v: p.beneficiary ? new PublicKey(String(p.beneficiary)) : (ctx?.creator ?? PublicKey.default) },
      // milestones [u64; 4]
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.m1, 10)))) },
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.m2, 50)))) },
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.m3, 250)))) },
      { t: "u64", v: 0n },
      { t: "u64", v: 1n }, // idle_slots unused in mode 0
      { t: "u64", v: pctRaw(num(p.minBuy, 0.02), supply) },
      { t: "u64", v: BigInt(Math.round(num(p.treasurySol, 1) * 1e9)) },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.3) * 1e9)) },
    ],
  },
  {
    id: "abandonmentrefund",
    name: "Abandonment refund",
    tagline: "If the token goes quiet, the treasury goes back to holders.",
    blurb:
      "An honest dead-man's switch. You lock SOL at launch; every trade resets a clock. If the token goes untraded for the window you set, anyone can open the treasury — it snapshots and becomes claimable pro-rata by whoever still holds, in proportion to what they hold. If the team walks away, the money comes back, and nobody has to be trusted to trigger it. \"Abandoned\" is only ever a proxy: one wash trade inside the window keeps the clock alive forever, so pick a window with that in mind.",
    program: "B2YVN1bWc95pSDBcZTpKgaH3v2JbmNKWRE5rSYNQ1m2x",
    statePrefix: "tr",
    preview: "ratelimit",
    accent: "a",
    family: "Rewards",
    meteora: "client",
    initPoolSeed: "trpool",
    initVaultSeed: "trvault",
    postLaunch: "claim",
    params: [
      { key: "treasurySol", label: "Treasury to lock", type: "range", min: 0.1, max: 50, step: 0.1, default: 1, unit: "SOL" },
      { key: "idleDays", label: "Untraded before refund", type: "range", min: 1, max: 365, step: 1, default: 30, unit: "days" },
      { key: "poolSol", label: "Slot rent pool", help: "pays the rent for each holder's ledger (~0.0012 SOL each)", type: "range", min: 0.05, max: 10, step: 0.05, default: 0.3, unit: "SOL" },
      { key: "minBuy", label: "Minimum first buy", help: "anti-spam: a wallet must buy at least this much to open its ledger", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.02, unit: "% supply" },
    ],
    toInitArgs: (p, supply, ctx) => [
      { t: "u8", v: 1 },
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "pubkey", v: ctx?.creator ?? PublicKey.default },
      { t: "u64", v: 0n }, { t: "u64", v: 0n }, { t: "u64", v: 0n }, { t: "u64", v: 0n },
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.idleDays, 30) * 216_000))) }, // ~400ms slots
      { t: "u64", v: pctRaw(num(p.minBuy, 0.02), supply) },
      { t: "u64", v: BigInt(Math.round(num(p.treasurySol, 1) * 1e9)) },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.3) * 1e9)) },
    ],
  },
  {
    id: "referral",
    name: "Referral rewards",
    tagline: "Every buy pays the buyer — and whoever referred them.",
    blurb:
      "A referral tree welded to the coin. Share your link; when someone buys through it, the SOL dividend that buy earns is split between them and you, at a share you set. The link is bound on-chain the first time they buy and can never be rewritten or switched off, so referrers can't be stiffed later. Referring yourself is rejected. Traded through Hooked's route, which binds the referrer in the same signature as the buy.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "emission",
    accent: "b",
    family: "Rewards",
    meteora: "client",
    initPoolSeed: "pool",
    postLaunch: "claim",
    params: [
      { key: "dividendSol", label: "Dividend per buy", help: "SOL each buy earns, split between buyer and referrer", type: "range", min: 0.0005, max: 0.05, step: 0.0005, default: 0.002, unit: "SOL" },
      { key: "referrerShare", label: "Referrer's share", help: "how much of each dividend goes to the referrer instead of the buyer", type: "range", min: 5, max: 90, step: 5, default: 30, unit: "%" },
      { key: "poolSol", label: "Dividend pool", type: "range", min: 0.1, max: 20, step: 0.1, default: 1, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", help: "anti-farm: a buy must be at least this big to open a slot", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 7 }, // mode 7 = referral split
      { t: "u64", v: BigInt(Math.round(num(p.dividendSol, 0.002) * 1e9)) },
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) },
      { t: "u64", v: 0n },
      { t: "u64", v: 1n },
      { t: "u64", v: BigInt(Math.min(10000, Math.round(num(p.referrerShare, 30) * 100))) }, // share bps
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 1) * 1e9)) },
      { t: "pubkey", v: PublicKey.default },
    ],
  },
  {
    id: "twoclass",
    name: "Presale + public launch",
    tagline: "Early buyers get in first but vest; everyone after is liquid.",
    blurb:
      "The structure real launches use, enforced by the chain instead of a spreadsheet. Wallets that buy during the presale window have their tokens vest on a cliff-and-drip schedule — they got in early, so they're locked in. Everyone who arrives after the window buys freely with no lock at all. Which class you're in is decided by the block you first bought, on-chain, and can't be edited afterwards.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "ratchet",
    accent: "b",
    family: "Caps",
    meteora: "client",
    initPoolSeed: "pool",
    presaleCutoff: true, // the launch flow resolves the window into an absolute slot
    summary: (p) => `Wallets that first buy in the first ${num(p.presaleHours, 24)} hours vest; later buyers are free. ${vestingSummary(p, "Presale wallets")}`,
    params: [
      { key: "presaleHours", label: "Presale window", help: "wallets that first buy within this window vest; later buyers are liquid", type: "range", min: 1, max: 168, step: 1, default: 24, unit: "hours" },
      { key: "cliffHours", label: "Presale cliff", help: "presale buyers unlock nothing until this long after their first buy", type: "range", min: 0, max: 168, step: 1, default: 24, unit: "hours" },
      { key: "unlockPct", label: "Presale unlock each period", help: "how much of a presale wallet's bag unlocks every period after the cliff", type: "range", min: 0.1, max: 100, step: 0.1, default: 10, unit: "%" },
      { key: "unlockEveryHours", label: "Unlock period", help: "how often an unlock happens: 1 = hourly, 24 = daily, 168 = weekly", type: "range", min: 1, max: 168, step: 1, default: 24, unit: "hours" },
      { key: "poolSol", label: "Slot-rent pool", type: "range", min: 0.1, max: 10, step: 0.1, default: 0.5, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    toInitArgs: (p, supply, ctx) => [
      { t: "u8", v: 5 }, // mode 5 = two-class vesting
      { t: "u64", v: ctx?.cutoffSlot ?? 0n }, // dividend field = absolute presale cutoff slot
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) },
      { t: "u64", v: BigInt(Math.round(num(p.cliffHours, 24) * 9000)) },
      { t: "u64", v: BigInt(unlockHours(p) * SLOTS_PER_HOUR) }, // period_slots
      { t: "u64", v: BigInt(Math.min(10000, Math.max(1, Math.round(unlockPct(p) * 100)))) }, // bps per period
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.5) * 1e9)) },
      { t: "pubkey", v: PublicKey.default },
    ],
  },
  {
    id: "convictioncap",
    name: "Conviction cap",
    tagline: "Hold without selling and your own buy limit grows.",
    blurb:
      "The opposite of a flat whale cap. Every wallet starts with a small per-trade limit; the longer it holds without selling, the higher its own limit climbs, up to a ceiling you set. Sell and the clock resets to the start. New money is throttled while proven holders earn the right to size up — a fair launch that opens per person rather than all at once. Pair it with a max-per-wallet if you're worried about someone farming it across many wallets.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "ratchet",
    accent: "a",
    family: "Caps",
    meteora: "client",
    initPoolSeed: "pool",
    params: [
      { key: "startCap", label: "Starting buy cap", type: "pct", min: 0.01, max: 2, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "growthPerDay", label: "Cap growth per day held", type: "pct", min: 0.01, max: 2, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "maxCap", label: "Cap ceiling", type: "pct", min: 0.1, max: 10, step: 0.1, default: 2, unit: "% supply" },
      { key: "poolSol", label: "Slot-rent pool", type: "range", min: 0.1, max: 10, step: 0.1, default: 0.5, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 6 }, // mode 6 = conviction cap
      { t: "u64", v: pctRaw(num(p.startCap, 0.1), supply) },     // starting cap
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) },
      { t: "u64", v: pctRaw(num(p.maxCap, 2), supply) },          // cliff_slots = ceiling
      { t: "u64", v: 216_000n },                                  // one day per growth step
      { t: "u64", v: pctRaw(num(p.growthPerDay, 0.1), supply) },  // bps_per_period = growth/day
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.5) * 1e9)) },
      { t: "pubkey", v: PublicKey.default },
    ],
  },
  {
    id: "diamondhand",
    name: "Diamond-hand dividend",
    tagline: "Hold longer, earn bigger SOL dividends — selling resets your streak.",
    blurb:
      "A SOL dividend paid on every buy, scaled by how long you've held: the longer since your last sell, the bigger each buy's payout, up to a cap. Any sell resets your streak to zero, so the reward flows to patient holders and dumpers fall back to the base rate. Funded by a SOL pool you pre-fund; claim your accrued SOL any time. Traded through Hooked's swap route.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "emission",
    accent: "b",
    family: "Rewards",
    meteora: "client",
    initPoolSeed: "pool",
    postLaunch: "claim",
    params: [
      { key: "baseSol", label: "Base dividend", help: "SOL paid per buy at the base (1×) rate, before the holding bonus", type: "range", min: 0.0005, max: 0.05, step: 0.0005, default: 0.002, unit: "SOL" },
      { key: "bonusPerDay", label: "Bonus per day held", help: "extra % added to the dividend for each day held since the last sell", type: "range", min: 5, max: 200, step: 5, default: 25, unit: "% per day" },
      { key: "maxBonus", label: "Max bonus", help: "the streak bonus stops growing here", type: "range", min: 50, max: 1000, step: 50, default: 300, unit: "%" },
      { key: "poolSol", label: "Dividend pool", type: "range", min: 0.1, max: 20, step: 0.1, default: 1, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 3 }, // mode 3 = diamond-hand
      { t: "u64", v: BigInt(Math.round(num(p.baseSol, 0.002) * 1e9)) }, // base dividend lamports
      { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) }, // min_new_slot
      // max bonus bps — NOT clamped to 10_000: this is a bonus multiplier on top of the base
      // dividend, so >100% is the whole point (the slider goes to 1000%).
      { t: "u64", v: BigInt(Math.max(0, Math.round(num(p.maxBonus, 300) * 100))) }, // cliff_slots = max bonus bps
      { t: "u64", v: 216_000n }, // period_slots = 1 day (streak period)
      { t: "u64", v: BigInt(Math.round(num(p.bonusPerDay, 25) * 100)) }, // bps_per_period = bonus/day bps
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u64", v: BigInt(Math.round(num(p.poolSol, 1) * 1e9)) }, // prefund the pool
      { t: "pubkey", v: PublicKey.default },
    ],
  },
  {
    id: "whalegraduated",
    name: "Graduated sell caps (slots)",
    tagline: "The bigger your bag, the less you can sell in one trade.",
    blurb:
      "A progressive anti-dump: small holders trade freely, but the more a wallet has accumulated, the tighter its per-sell cap — down to a floor. Whales can build a position but can't unload it in one go, enforced per wallet in the swap. Traded through Hooked's swap route.",
    program: "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Caps",
    meteora: "client",
    initPoolSeed: "pool",
    params: [
      { key: "baseSellCap", label: "Base sell cap", help: "the largest one sell for a small holder", type: "pct", min: 0.05, max: 5, step: 0.05, default: 1, unit: "% supply" },
      { key: "floorSellCap", label: "Floor sell cap", help: "the tightest a whale's per-sell cap ever gets", type: "pct", min: 0.01, max: 1, step: 0.01, default: 0.1, unit: "% supply" },
      { key: "tightenAt", label: "Reaches floor at holding", help: "a wallet holding this much hits the floor sell cap", type: "pct", min: 0.5, max: 10, step: 0.5, default: 3, unit: "% supply" },
      { key: "poolSol", label: "Slot-rent pool", type: "range", min: 0.1, max: 10, step: 0.1, default: 0.5, unit: "SOL" },
      { key: "minBuy", label: "Minimum qualifying buy", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.05, unit: "% supply" },
    ],
    // sell_cap = max(floor, base - received*1000/factorMilli); floor is hit at `tightenAt` received.
    toInitArgs: (p, supply) => {
      const base = pctRaw(num(p.baseSellCap, 1), supply);
      const floor = pctRaw(num(p.floorSellCap, 0.1), supply);
      const tightenAt = pctRaw(num(p.tightenAt, 3), supply);
      // The on-chain cut is `received * 1000 / factorMilli`, so the wallet hits the floor cap at
      // exactly `tightenAt` received. Carried ×1000 because an integer factor truncates hard —
      // a plain `tightenAt / span` floors to 0 for most in-range settings (see drip mode 4).
      const span = base > floor ? base - floor : 1n;
      const factorMilli = (tightenAt * 1000n + span / 2n) / span || 1n;
      return [
        { t: "u8", v: 4 }, // mode 4 = whale-graduated sell cap
        { t: "u64", v: base }, // dividend field = base sell cap
        { t: "u64", v: pctRaw(num(p.minBuy, 0.05), supply) }, // min_new_slot
        { t: "u64", v: floor }, // cliff_slots = floor sell cap
        { t: "u64", v: factorMilli }, // period_slots = factor × 1000
        { t: "u64", v: 0n }, // bps_per_period unused
        { t: "pubkey", v: DBC_POOL_AUTHORITY },
        { t: "u64", v: BigInt(Math.round(num(p.poolSol, 0.5) * 1e9)) }, // prefund slot-rent pool
        { t: "pubkey", v: PublicKey.default },
      ];
    },
  },
  {
    id: "dues",
    name: "Membership dues",
    tagline: "Hold a membership token AND pay dues to receive it.",
    blurb:
      "A members-only token with a turnstile: to buy or receive it, a wallet must already hold a gate token you choose (a membership NFT, another coin) AND pay a dues fee in the same transaction. Both checks run in the swap — no separate gate contract. Members can sell back to the pool freely. Traded through Hooked's swap route.",
    program: "5M6KxRdyf3Vkw27prDB3KHF4A2xGPvTmjA2DK3abLo4r",
    statePrefix: "du",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "client",
    params: [
      { key: "gateMint", label: "Membership token mint", help: "wallets must hold at least 1 of this token to receive yours", type: "pubkey", default: "", required: true },
      { key: "duesSol", label: "Dues per trade", type: "range", min: 0.0005, max: 0.5, step: 0.0005, default: 0.005, unit: "SOL" },
    ],
    toInitArgs: (p, _s, ctx) => [
      { t: "pubkey", v: p.gateMint ? new PublicKey(String(p.gateMint)) : PublicKey.default },
      { t: "u64", v: BigInt(Math.round(num(p.duesSol, 0.005) * 1e9)) },
      { t: "pubkey", v: ctx?.creator ?? PublicKey.default }, // dues receiver = the creator
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
    ],
  },

  // ── Per-holder accounting (hlazy): the hook writes a per-WALLET slot on each trade,
  //    created lazily on first receipt from a pre-funded pool. Owner-derived seed → the
  //    per-buyer account isn't resolvable by stock DEX aggregators (meteora: "client"). ──
  {
    id: "maxwallet",
    name: "Max per wallet (lifetime)",
    tagline: "A hard cap on how much any single wallet can ever buy.",
    blurb:
      "The hook keeps a per-wallet tally of everything a wallet has received and rejects the trade that would push it over your cap — a true fair-launch max-per-wallet, enforced in the swap, not a snapshot. The wallet's slot is created on its first buy (no pre-registration). Enforced on-chain; because the slot is keyed on the buyer, trading needs a Hooked-aware client.",
    program: "GaFtqyc9vCurVxPtQHKSyg66KeVp7rBwQL6Mkwj9U51y",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Caps",
    meteora: "client",
    initPoolSeed: "pool",
    params: [
      { key: "maxWallet", label: "Max per wallet", type: "pct", min: 0.05, max: 5, step: 0.05, default: 1, unit: "% supply" },
      { key: "slots", label: "Wallet slots to fund", help: "the launch pre-funds one per-wallet slot each — more slots = more holders supported, at ~0.0012 SOL each", type: "range", min: 20, max: 5000, step: 20, default: 200, unit: "wallets" },
      { key: "minBuy", label: "Minimum first buy", help: "anti-drain: a new wallet must receive at least this much to open its slot, so dust spam can't burn the pool", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.01, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 0 }, // mode 0 = cumulative-received cap
      { t: "u64", v: pctRaw(num(p.maxWallet, 1), supply) },
      { t: "u64", v: 0n }, // cooldown unused
      { t: "u64", v: BigInt(Math.round(num(p.slots, 200))) * 1_200_000n }, // prefund the per-wallet slot pool
      { t: "u64", v: pctRaw(num(p.minBuy, 0.01), supply) }, // min_new_slot: the smallest first buy
    ],
  },
  {
    id: "cooldown",
    name: "Wallet cooldown",
    tagline: "Each wallet must wait between buys — per-wallet anti-spam.",
    blurb:
      "Every wallet gets its own cooldown: after receiving, it can't receive again until N blocks have passed. Independent per wallet, so one buyer's cooldown never blocks another — an on-chain anti-bot / anti-spam throttle. Slots are created lazily on first buy. Because the slot is keyed on the buyer, trading needs a Hooked-aware client.",
    program: "GaFtqyc9vCurVxPtQHKSyg66KeVp7rBwQL6Mkwj9U51y",
    statePrefix: "cfg",
    preview: "ratelimit",
    accent: "b",
    family: "Guards",
    meteora: "client",
    initPoolSeed: "pool",
    params: [
      { key: "cooldownSlots", label: "Cooldown", type: "range", min: 1, max: 300, step: 1, default: 25, unit: "blocks" },
      { key: "slots", label: "Wallet slots to fund", help: "the launch pre-funds one per-wallet slot each — more slots = more holders supported, at ~0.0012 SOL each", type: "range", min: 20, max: 5000, step: 20, default: 200, unit: "wallets" },
      { key: "minBuy", label: "Minimum first buy", help: "anti-drain: a new wallet must receive at least this much to open its slot, so dust spam can't burn the pool", type: "pct", min: 0.001, max: 1, step: 0.001, default: 0.01, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u8", v: 1 }, // mode 1 = per-wallet cooldown
      { t: "u64", v: 0n }, // max_recv unused
      { t: "u64", v: BigInt(Math.round(num(p.cooldownSlots, 25))) },
      { t: "u64", v: BigInt(Math.round(num(p.slots, 200))) * 1_200_000n }, // prefund the per-wallet slot pool
      { t: "u64", v: pctRaw(num(p.minBuy, 0.01), supply) }, // min_new_slot: the smallest first buy
    ],
  },

  // ── Asymmetric buy/sell caps (asym, Batch 52): different rules per direction by reading
  //    transfer provenance against the pool authority. Mint-keyed → Meteora-verified. ──
  {
    id: "antidump",
    name: "Anti-dump caps",
    tagline: "A loose cap on buys and a tight cap on sells — enforced in the swap.",
    blurb:
      "The hook tells a buy from a sell by looking at who's sending: a swap out of the pool is a buy, a swap into the pool is a sell. It applies a separate size cap to each side, so you can let people buy freely while capping how much any single trade can sell — an on-chain anti-dump that a whale can't route around. Mint-keyed, confirmed live on Meteora (a 90%-of-bag sell is rejected while buys and small sells pass).",
    program: "Ft8R4BsJp7n3dGKsd1RbAi3WrvkiH5s5z2jyDztEQJ6f",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Caps",
    meteora: "verified",
    params: [
      { key: "buyCap", label: "Max per buy", help: "the largest amount one buy can acquire (0 = no buy cap)", type: "pct", min: 0, max: 5, step: 0.05, default: 2, unit: "% supply" },
      { key: "sellCap", label: "Max per sell", help: "the largest amount one sell can offload — set this tighter than the buy cap for anti-dump", type: "pct", min: 0.1, max: 2, step: 0.01, default: 0.25, unit: "% supply" },
    ],
    toInitArgs: (p, supply) => [
      { t: "u64", v: pctRaw(num(p.buyCap, 2), supply) },
      { t: "u64", v: pctRaw(num(p.sellCap, 0.25), supply) },
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
    ],
  },

  // ── Transfer-routing gate (depth): reads get_stack_height() to tell a direct wallet
  //    transfer (depth 2) from a DEX-routed one (depth 3). Mint-keyed → Meteora-safe. ──
  {
    id: "dexonly",
    name: "DEX-only",
    tagline: "Moves only through a DEX, never wallet to wallet.",
    blurb:
      "The hook reads its own CPI stack depth: a plain wallet-to-wallet transfer runs it at depth 2, a DEX/router swap one frame deeper. This mode rejects the direct transfers, so the token can only move through an exchange — no quiet OTC / off-book wallet moves. Mint-keyed, confirmed live on Meteora.",
    program: "4FYZUzNqHxLRLs8bhoQf71yRW8i2jPxJxLZJFcqB9Xom",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "verified",
    params: [],
    toInitArgs: () => [{ t: "u8", v: 1 }], // mode 1 routed-only
  },
  {
    id: "p2ponly",
    name: "P2P-only (no curve)",
    tagline: "Blocks DEX swaps — the token only moves wallet-to-wallet.",
    blurb:
      "The inverse of DEX-only: the hook rejects any transfer nested under a program (a DEX/router swap runs it one frame deeper than a direct transfer), so the token can't be bought or sold on an AMM — it only moves directly between wallets. A deliberate non-tradeable / airdrop-locked / OTC-only token. Mint-keyed, confirmed live on Meteora.",
    program: "4FYZUzNqHxLRLs8bhoQf71yRW8i2jPxJxLZJFcqB9Xom",
    statePrefix: "cfg",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "verified",
    params: [],
    toInitArgs: () => [{ t: "u8", v: 0 }], // mode 0 P2P-only
  },

  // ── Whole-transaction gates (gatekeep, Batch 52): the hook reads the WHOLE transaction via
  //    the Instructions sysvar, not just its own args — so it can require the tx to route
  //    through a venue, pay a royalty/tithe, or carry a Merkle proof. Mint-keyed state, but the
  //    royalty/tithe/allowlist modes need an extra instruction in the swap tx → Hooked route. ──
  {
    id: "venuelock",
    name: "Venue-locked",
    tagline: "Trades only through its Meteora pool, never wallet to wallet.",
    blurb:
      "The hook checks that the transaction routes through the Meteora pool program; a plain wallet-to-wallet transfer (which doesn't) is rejected. Every trade hits your official liquidity, and the token can't be quietly moved OTC or between insider wallets. Mint-keyed, Meteora-verified — normal buys and sells just work.",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "verified",
    params: [],
    toInitArgs: () => [
      { t: "u8", v: 0 }, // mode 0 = venue allowlist
      { t: "pubkey", v: DBC_PROGRAM }, // the venue every pool swap routes through
      { t: "u64", v: 0n },
      { t: "pubkey", v: PublicKey.default },
      { t: "bytes32", v: new Uint8Array(32) },
    ],
  },
  {
    id: "royalty",
    name: "Enforced royalty",
    tagline: "Every trade pays you a royalty — on-chain, unavoidable.",
    blurb:
      "The hook rejects any transfer whose transaction doesn't also pay your royalty to your wallet, verified from the transaction itself — the WEN-royalty idea, actually enforced in the transfer path with no marketplace cooperation. Because the payment must ride in the swap, this token trades through the Hooked route (a bare aggregator swap won't include it) — best for collectibles and low-velocity tokens.",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "client",
    params: [
      { key: "royaltySol", label: "Royalty per trade", help: "SOL paid to you on every trade; the transaction is rejected if it isn't included", type: "range", min: 0.0005, max: 0.5, step: 0.0005, default: 0.005, unit: "SOL" },
    ],
    toInitArgs: (p, _s, ctx) => [
      { t: "u8", v: 1 }, // mode 1 = royalty payment
      { t: "pubkey", v: PublicKey.default },
      { t: "u64", v: BigInt(Math.round(num(p.royaltySol, 0.005) * 1e9)) },
      { t: "pubkey", v: ctx?.creator ?? PublicKey.default }, // royalty receiver = the creator
      { t: "bytes32", v: new Uint8Array(32) },
    ],
  },
  {
    id: "tithe",
    name: "Tithe token",
    tagline: "Every trade donates to a cause you choose — by construction.",
    blurb:
      "Same enforcement as the royalty, but the payment goes to an address you name — a charity, a treasury, a public-goods fund. Every trade of the token funds the cause, verified in the transaction and rejected if it's missing. Trades through the Hooked route (the donation must ride in the swap tx).",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "client",
    params: [
      { key: "charity", label: "Recipient address", help: "the wallet every trade donates to (a charity or treasury)", type: "pubkey", default: "", required: true, placeholder: "Recipient address" },
      { key: "donationSol", label: "Donation per trade", type: "range", min: 0.0005, max: 0.5, step: 0.0005, default: 0.005, unit: "SOL" },
    ],
    toInitArgs: (p) => [
      { t: "u8", v: 1 }, // mode 1 = required payment (to a chosen recipient)
      { t: "pubkey", v: PublicKey.default },
      { t: "u64", v: BigInt(Math.round(num(p.donationSol, 0.005) * 1e9)) },
      { t: "pubkey", v: p.charity ? new PublicKey(String(p.charity)) : PublicKey.default },
      { t: "bytes32", v: new Uint8Array(32) },
    ],
  },
  {
    id: "allowlist",
    name: "Allowlist token",
    tagline: "Only wallets on your list can buy and hold it.",
    blurb:
      "You provide a list of wallet addresses at launch; the hook only lets those wallets receive the token, verified against a Merkle root with a proof carried in the trade. A presale/whitelist or members-only token with no separate presale contract — the allowlist lives in the token. Anyone on the list can sell back to the pool; non-listed wallets can't buy. Trades through the Hooked route (it attaches the proof).",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "client",
    allowlist: true, // special launch UI + registry storage of the wallet list
    params: [],
    toInitArgs: (p) => [
      { t: "u8", v: 2 }, // mode 2 = Merkle allowlist
      { t: "pubkey", v: PublicKey.default },
      { t: "u64", v: 0n },
      { t: "pubkey", v: PublicKey.default },
      { t: "bytes32", v: merkleRoot(parseAllowlist(p.allowlist as string | undefined)) },
    ],
  },
  {
    id: "rollingwaitlist",
    name: "Rolling waitlist",
    tagline: "Add wallets in waves — access widens on your schedule.",
    blurb:
      "An allowlist you can widen after launch. Start with wave one, then publish new waves as more people sign up — each wave replaces the on-chain list. Be honest with your community about the trade: until you freeze it, the same power that adds wallets can remove them, so every change is versioned on-chain and the token page shows the current wave. Freezing is one click and permanent.",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "client",
    allowlist: true,
    rootControl: true, // launch also opens the ["gkctl", mint] authority account
    params: [],
    toInitArgs: (p) => [
      { t: "u8", v: 2 }, // mode 2 = Merkle allowlist (the root is updatable via set_merkle_root)
      { t: "pubkey", v: PublicKey.default },
      { t: "u64", v: 0n },
      { t: "pubkey", v: PublicKey.default },
      { t: "bytes32", v: merkleRoot(parseAllowlist(p.allowlist as string | undefined)) },
    ],
  },
  {
    id: "progressivetax",
    name: "Exit toll",
    tagline: "Selling costs a fee that scales with how much you sell.",
    blurb:
      "Every sell must pay a fee in the same transaction, and the fee scales with the number of tokens sold — small exits cost little, big ones cost real money. Buying is free. The fee goes to an address you name (a treasury, a charity, yourself) and the sell is simply rejected if it isn't paid, so it funds something and dampens dumping at once. Note it's priced per token, not as a percentage of value: a hook can see how many tokens move but never what they're worth.",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "client",
    params: [
      { key: "receiver", label: "Fee recipient", help: "the wallet every toll is paid to", type: "pubkey", default: "", required: true },
      { key: "tollPerThousand", label: "Toll per 1,000 tokens sold", help: "SOL charged for every 1,000 tokens a sell moves", type: "range", min: 0.00001, max: 0.01, step: 0.00001, default: 0.0005, unit: "SOL" },
    ],
    toInitArgs: (p) => [
      { t: "u8", v: 3 }, // mode 3 = exit toll (royalty field carries lamports per 1,000 tokens)
      { t: "pubkey", v: DBC_POOL_AUTHORITY }, // venue doubles as the pool authority for sell detection
      { t: "u64", v: BigInt(Math.max(1, Math.round(num(p.tollPerThousand, 0.0005) * 1e9))) },
      { t: "pubkey", v: p.receiver ? new PublicKey(String(p.receiver)) : PublicKey.default },
      { t: "bytes32", v: new Uint8Array(32) },
    ],
  },
  {
    id: "gatedlaunch",
    name: "Gated launch",
    tagline: "Your list buys first — then it opens to everyone when it graduates.",
    blurb:
      "The same Merkle allowlist, but launched on a graduating curve on purpose. While the token is on the bonding curve only wallets on your list can buy. When it fills the curve and graduates to a full AMM, the migration takes the transfer hook off — so the gate disappears by itself and the token becomes permissionlessly tradeable by anyone, forever. Your people first, then the world, with both halves enforced by the chain rather than promised.",
    program: "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs",
    statePrefix: "gk",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "client",
    allowlist: true,
    // The whole mechanic is "the hook lifts at graduation", which only happens on a curve that
    // can actually graduate — so this behavior pins the curve rather than letting it be chosen.
    forceCurve: "normal",
    params: [],
    toInitArgs: (p) => [
      { t: "u8", v: 2 }, // mode 2 = Merkle allowlist (same enforcement; the curve is what differs)
      { t: "pubkey", v: PublicKey.default },
      { t: "u64", v: 0n },
      { t: "pubkey", v: PublicKey.default },
      { t: "bytes32", v: merkleRoot(parseAllowlist(p.allowlist as string | undefined)) },
    ],
  },

  // ── Market monitor (mhook): per-slot buy throttle + a live buy/sell volume feed. ──
  {
    id: "marketmon",
    name: "Market monitor",
    tagline: "Throttles buys per block and publishes a live buy/sell feed.",
    blurb:
      "A composite market hook: it tells buys from sells by provenance, caps how many buys clear per block (anti-bundler), and keeps running buy/sell counts and volumes in on-chain state — so the token doubles as its own live market feed any program can read. Confirmed live on Meteora.",
    program: "DURKELkRRfrCuLs4fgSmDFPX2bXDCXDEQhQU2925JkNb",
    statePrefix: "m",
    preview: "ratelimit",
    accent: "a",
    family: "Guards",
    meteora: "verified",
    params: [
      { key: "maxBuysPerSlot", label: "Max buys per block", type: "range", min: 1, max: 20, step: 1, default: 3, unit: "buys" },
    ],
    toInitArgs: (p) => [
      { t: "pubkey", v: DBC_POOL_AUTHORITY },
      { t: "u32", v: Math.round(num(p.maxBuysPerSlot, 3)) },
    ],
  },

  // ── Basket index (basket): a coupled cap tracking an equal-weight basket of siblings. ──
  {
    id: "basket",
    name: "Basket index",
    tagline: "Track an equal-weight basket of other Hooked tokens.",
    blurb:
      "Like the weighted index, but every member counts equally: the cap moves with the average net buy pressure of a basket of reactive-family tokens. A sector or theme token that reacts to a whole group at once. A separate program from the weighted index.",
    program: "BfTwawNVYa1V1D3naJPrb9zmpv2ypXri99n224ec2SiB",
    statePrefix: "bk",
    preview: "index",
    accent: "b",
    family: "Reactive",
    meteora: "safe",
    needsPartner: "many",
    partnerHint: "Comma-separated Hooked reactive-family mints — each counts equally.",
    partnerFamily: ["reactive"],
    couplingKeys: ["members"],
    params: [
      { key: "members", label: "Basket mints", type: "pubkeyList", help: "comma-separated", default: "" },
      { key: "base", label: "Base cap", type: "pct", min: 0.1, max: 10, step: 0.1, default: 1, unit: "% supply / buy" },
      { key: "sens", label: "Sensitivity", type: "range", min: 1, max: 100, step: 1, default: 25, unit: "%" },
    ],
    toInitArgs: (p, supply) => {
      const members = pkList(p.members);
      const base = pctRaw(num(p.base, 1), supply);
      const step = (base * BigInt(Math.round(num(p.sens, 25) * 100))) / 10_000n;
      return [
        { t: "u8", v: 1 }, // mode 1 = index
        { t: "u64", v: base },
        { t: "u64", v: step },
        { t: "u64", v: pctRaw(1, supply) }, // unit
        { t: "pubkey", v: DBC_POOL_AUTHORITY },
        { t: "vec_pubkey", v: members.map((m) => psFeed(m)) }, // each member's live feed (state PDA)
      ];
    },
  },

  // ── Holder-gated (ghook): only wallets already holding a chosen token can receive.
  //    Reads the recipient's ATA for the gate mint (owner-derived) → meteora "client". ──
  {
    id: "holdergated",
    name: "Holder-gated",
    tagline: "Only wallets holding your chosen token can receive.",
    blurb:
      "To receive this token a wallet must already hold a gate token you pick — a membership token, an NFT, another coin. The hook reads the recipient's balance of the gate mint and rejects the transfer if it's missing or empty: community-gated / allowlist-by-holding / soulbound-to-a-group, with no maintained address list. Because the check is keyed on the recipient, trading needs a Hooked-aware client.",
    program: "2WsdXUpABzpXbiPcKrDYypdgzr2EybGorWFHBDXYtSGx",
    statePrefix: "cfg", // unused (no state PDA)
    preview: "gate",
    accent: "b",
    family: "Guards",
    meteora: "client",
    noState: true,
    params: [
      { key: "gateMint", label: "Gate token mint", type: "pubkey", help: "wallets must hold this token to receive", default: "", required: true },
    ],
    toInitArgs: (p) => [{ t: "pubkey", v: p.gateMint && String(p.gateMint).trim() ? new PublicKey(String(p.gateMint).trim()) : PublicKey.default }],
  },

  // ── Publisher for the coupled family: a freely-tradeable token whose volume is the trigger ──
  {
    id: "beacon",
    name: "Beacon (volume)",
    tagline: "Trade it freely. The more of it changes hands, the closer its Entangled token gets to unlocking.",
    blurb:
      "No cap and no gate. The Beacon keeps an on-chain running total of how many of its tokens have changed hands: every buy, sell and wallet transfer adds to it, and it never goes down. Pair it with an Entangled token, and that token unlocks for good once the total reaches the amount you set.",
    program: "5aAXdggDpJBtAfDoFusTp44tj5XpBXbxuCwDqpc17SBb",
    statePrefix: "tw",
    preview: "gate",
    accent: "a",
    family: "Reactive",
    meteora: "verified",
    params: [],
    toInitArgs: () => [
      { t: "u8", v: 1 },                 // mode 1 = accumulate-only publisher (never locks)
      { t: "u64", v: 0n },               // threshold unused in publisher mode
      { t: "pubkey", v: PublicKey.default },
    ],
  },
  {
    // Combined rules: one hook carrying several of the rules above, picked at launch. The
    // launcher builds the real settings list from the pick (app/lib/node/combo.ts comboNode).
    id: "combo",
    name: "Combined rules",
    tagline: "Several rules on one token, picked at launch.",
    blurb:
      "One hook that runs any mix of Trade guard, Anti-dump caps, Graduated sell caps, Max per wallet, Chapters, Rising max per wallet, Anti-bundle, DEX-only, FOMO-only buys and Sniper-fee cap. Each rule you pick works exactly like its single-rule version; the ones you don't pick are skipped. Pairs that would set the same limit twice can't be combined. Your wallet is exempt from the wallet caps, FOMO-only and the Sniper-fee cap. The rules are fixed at launch.",
    program: "C3vEdPepTPRrJdQ4nQ3ZmhdXCmpKdGRKVUqxduHZWbdR",
    statePrefix: "cfg",
    preview: "gate",
    accent: "a",
    family: "Guards",
    meteora: "safe",
    combo: true,
    params: [],
    toInitArgs: () => [], // not used: see app/lib/node/combo.ts
  },
];

export const nodeById = (id: string) => NODE_TYPES.find((n) => n.id === id);

// The original 8 behaviors predate the `family`/`meteora` fields; resolve them here.
const FAMILY_FALLBACK: Record<string, Family> = {
  breathing: "Caps",
  reactive: "Reactive", entangled: "Reactive", index: "Reactive", inverse: "Reactive", guard: "Guards",
};
export const FAMILY_ORDER: Family[] = ["Caps", "Dynamics", "Emission", "Rewards", "Reactive", "Guards"];
export function familyOf(n: NodeType): Family { return n.family ?? FAMILY_FALLBACK[n.id] ?? "Guards"; }
export function meteoraOf(n: NodeType): "verified" | "safe" | "client" { return n.meteora ?? "verified"; }
export const isCore = (n: NodeType) => n.tier === "core";
export const coreTypes = () => NODE_TYPES.filter(isCore);
export const advancedTypes = () => NODE_TYPES.filter((n) => !isCore(n));

// The three things launchers actually want — the headline products. Each maps to one hook
// behavior (+ close alternatives). The wedge is "enforced by Solana, not a promise."
export type Preset = { id: string; name: string; tagline: string; pitch: string; enforce: string; behaviors: string[]; accent: "a" | "b"; icon: string };
export const PRESETS: Preset[] = [
  {
    id: "fairlaunch",
    name: "Fair Launch",
    tagline: "Un-snipeable. Un-whaleable. From block one.",
    pitch: "Cap how much any single wallet can grab, or how many trades clear per block — so bundlers can't atomically sweep your launch and no whale can grab a giant bag in one buy.",
    enforce: "Enforced inside every swap by the token itself — not a bot you have to trust to react in time.",
    behaviors: ["antisniper", "guard"], accent: "a", icon: "◈",
  },
  {
    id: "buyback",
    name: "Buyback & Burn",
    tagline: "Trading buys back and burns — automatically, forever.",
    pitch: "Every trade fills an on-chain reward vault; anyone can trigger a permissionless burn that keeps the token scarce. A real buy-and-burn, welded to the coin.",
    enforce: "It can't be switched off, skipped, or faked — the burn is on-chain, not a team's promise.",
    behaviors: ["buyburn"], accent: "b", icon: "▽",
  },
  {
    id: "rewards",
    name: "Holder Rewards",
    tagline: "Every trade pays your holders.",
    pitch: "Each trade mines a separate reward token to a vault — decaying like Bitcoin's halving, or a jackpot roll at odds you set. A trustless reward economy baked into trading.",
    enforce: "Minted on-chain on every real swap — no snapshot, no distributor wallet, nothing to rug.",
    behaviors: ["halving", "jackpot"], accent: "a", icon: "◇",
  },
];
export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export function defaultParams(n: NodeType): Record<string, number | string> {
  const o: Record<string, number | string> = {};
  for (const p of n.params) o[p.key] = p.default;
  return o;
}

export function supplyRawOf(supplyWhole: number, decimals: number = BASE_DECIMALS): bigint {
  return BigInt(Math.floor(supplyWhole)) * BigInt(10) ** BigInt(decimals);
}
/** The launching token's decimals, as the launch pipeline passes them to every rule's setup
 *  (params.__decimals); tokens from before decimals were selectable have 6. */
export function decimalsOf(p: Record<string, number | string>): number {
  const d = Math.round(num(p.__decimals ?? p.decimals, BASE_DECIMALS));
  return d >= 0 && d <= 9 ? d : BASE_DECIMALS;
}
/** One whole token in raw units. */
export const tokenUnit = (p: Record<string, number | string>): bigint => 10n ** BigInt(decimalsOf(p));

export function couplingMints(n: NodeType, p: Record<string, number | string>): string[] {
  if (!n.couplingKeys) return [];
  const out: string[] = [];
  for (const k of n.couplingKeys) {
    for (const s of String(p[k] ?? "").split(/[\s,]+/)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

// Mainnet runs the same programs at the same addresses, except these four: three whose original
// deploy keys were lost, and Max per wallet, whose old mainnet copy was closed. Each was deployed
// from the same source under a new address.
export const MAINNET_PROGRAM_IDS: Record<string, string> = {
  "9Kvwjjf2f9jP64JuC5AHfCQdxynHV1e678kfZCpiJ31z": "D92gP881Q8q1LhvKCbUiyz5vn86DyiNZ9S2z2V9v8gAr", // Trade guard (vhook)
  "AsqN4BA2cGmzbajL5rdg8rmfAsWs2K4TBS7Eqa8eLaY8": "7zxho6cRXcazb97vA9RSdWQ6dUvUHPe9koTRsn5WfmQr", // Anti-bundle (lhook)
  "A7m1Pw8Kj8YfSEjZe3SEHAzeFE3xZPTmH4XqhLqRhQsc": "AFQCJz9Q7TXgJe86MqrCLR1LjPL2W1zmjA4NidmgbJnn", // Chapters (evolve)
  "BVM8FK38fAJdWj4pezJh9xHaYaektV4f5Df9dq7y5TDC": "4GsxAQV9NeDh4J9HX4dWRfNFacxiqHKRf6RxGJoLuK8n", // Max per wallet (its mainnet copy was closed)
};
if (!IS_DEVNET) for (const n of NODE_TYPES) n.program = MAINNET_PROGRAM_IDS[n.program] ?? n.program;
