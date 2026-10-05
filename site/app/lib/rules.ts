import catalog from "./catalog.json";

// Every rule Hooked can launch: one transfer-hook behaviour per token (Token-2022 allows a
// single hook program per mint). The core rules are proven enforcing inside a live Meteora
// swap on devnet (the July 2026 audit, plus scripts/e2e-*.mts for newer ones) and carry
// hand-written copy and demos. The rest come straight from the behaviour catalogue (app/lib/catalog.json,
// generated from app/lib/node/nodeTypes.ts) and are shown as "in the lab".

export type GroupId = "custom" | "hold" | "sell" | "fair" | "trade" | "when" | "physics" | "paid" | "link";

export type DemoKind =
  | "seats" | "list" | "dues"
  | "vest" | "twoclass" | "antidump"
  | "tradecap" | "bundle" | "walletcap" | "reactive"
  | "gated" | "venue" | "p2p" | "dex" | "chapters" | "sellcap" | "fomo" | "pumpapp" | "social" | "opensea" | "timecap" | "feecap" | "hours" | "skin" | "pingpong" | "physics" | "pegs" | "potato" | "blocklist" | "schedule" | "custom" | "conviction" | "king"
  | "usdc" | "sol" | "royalty" | "tithe"
  | "entangled" | "beacon"
  | "gate" | "reward" | "airdrop";

export type Family = "Caps" | "Dynamics" | "Emission" | "Rewards" | "Reactive" | "Guards";

export type Rule = {
  id: string;
  group: GroupId;
  name: string;
  demo: DemoKind;
  /** true = trades through any DEX; false = needs the Hooked swap route */
  anyVenue: boolean;
  desc: string;
  chips: string[];
  /** proven enforcing inside a live Meteora swap (the July 2026 audit) */
  verified: boolean;
  /** new program, tested end to end on devnet but not yet through a live Meteora swap */
  fresh: boolean;
  family: Family;
  program: string;
};

type CatalogEntry = (typeof catalog)[number];

/** Rules Hooked no longer offers: Presale + public is now Holder vesting's "only vest early
 *  buyers" setting, SOL dividends is covered by Dividends, Enforced royalty is a tax, the
 *  volume Beacon/Entangled pair became the market-cap one, Price floor was cut, and the
 *  lifetime Max per wallet (which needed a pre-funded slot per wallet) became the balance cap,
 *  and Growing holder cap, Breathing cap, Basket index, Inverse pair, Weighted index,
 *  Dump-catcher and Jackpot were dropped, as were Halving mining, every lab reward rule, Gated
 *  launch, Exit toll, Membership dues, Market monitor, Rolling waitlist, Tiered membership,
 *  The Vise, Wallet cooldown and Conviction cap. Graduated sell caps moved to a program with
 *  no per-wallet slots.
 *  P2P-only moved to its own program so the creator can buy the curve.
 *  Tokens already launched with them still display by name. "combo" (Combined rules) is picked
 *  through the launcher's Combine switch, never as a single rule. */
export const HIDDEN_RULE_IDS = new Set(["combo", "skin", "twoclass", "dividends", "royalty", "realyield", "entangled", "beacon", "oraclefloor", "maxwallet", "holdercap",
  "basket", "inverse", "index", "dumpcatcher", "jackpot",
  "halving", "buyburn", "tokendividends", "milestonetreasury", "abandonmentrefund", "referral", "diamondhand",
  "gatedlaunch", "progressivetax", "p2ponly", "dues",
  "marketmon", "rollingwaitlist", "tieredmembership", "vise",
  "cooldown", "convictioncap", "whalegraduated"]);

export const GROUPS: { id: GroupId; title: string }[] = [
  { id: "custom", title: "AI-assisted hook creation" },
  { id: "hold", title: "Who can hold" },
  { id: "sell", title: "When you can sell" },
  { id: "fair", title: "Fair launch" },
  { id: "trade", title: "Where it trades" },
  { id: "when", title: "When it trades" },
  { id: "physics", title: "Physics in tokens" },
  { id: "paid", title: "Who gets paid" },
  { id: "link", title: "Linked tokens" },
];

/** How the lab rules are grouped, in display order, with the colour group each borrows. */
export const LAB_FAMILIES: { family: Family; title: string; group: GroupId }[] = [
  { family: "Guards", title: "Guards & access", group: "hold" },
  { family: "Caps", title: "Caps & schedules", group: "sell" },
];

export const GROUP_COLOR: Record<GroupId, string> = {
  custom: "#F4EEFF",
  hold: "#3BE3FF",
  sell: "#9D5CFF",
  fair: "#FFD23F",
  trade: "#7AA2FF",
  when: "#43F0A0",
  physics: "#C6FF4D",
  paid: "#FF8A3D",
  link: "#FF2E93",
};

type Curated = { id: string; group: GroupId; name: string; demo: DemoKind; desc: string; chips: string[] };

const VERIFIED: Curated[] = [
  { id: "pegs", group: "hold", name: "Pegs", demo: "pegs",
    desc: "The supply becomes a fixed collection of numbered objects, up to 65,535. Every whole unit a wallet holds is one of them, with its own number and art: buying across a unit mints a number, selling below one burns your newest, and sending tokens moves your newest objects with them. Upload your own art at launch, or let Hooked draw one from each number.",
    chips: ["numbered objects", "your own art", "moves with transfers"] },
  { id: "blocklist", group: "hold", name: "Blocklist", demo: "blocklist",
    desc: "The opposite of an allowlist: up to 200 wallets you name can never receive the token. They can't buy it and nobody can send it to them; everyone else trades normally, on any DEX. The list is sealed at launch, so it can never change.",
    chips: ["named wallets can't receive", "sealed at launch", "trades on any DEX"] },
  { id: "allowlist", group: "hold", name: "Allowlist", demo: "list",
    desc: "You upload a list of wallets at launch. Only those wallets can receive the token, checked against a Merkle root with a proof carried in the trade.",
    chips: ["your wallet list", "Merkle-proof check", "no presale contract"] },
  { id: "holdergated", group: "hold", name: "Holder-gated", demo: "gated",
    desc: "To receive this token a wallet must already hold a token you pick: a membership token, an NFT or another coin. The hook checks the receiving wallet's balance of it on every buy and transfer.",
    chips: ["holders of your chosen token", "checked on every transfer"] },
  { id: "vesting", group: "sell", name: "Holder vesting", demo: "vest",
    desc: "Each wallet's tokens unlock on their own clock from the moment it buys: nothing during the cliff, then a fixed share every period, from every hour to once a week. Vest every wallet, or only the ones that buy early, like a presale. A wallet can only sell what it has unlocked.",
    chips: ["24h cliff", "hourly to weekly", "optional presale window"] },
  { id: "potato", group: "sell", name: "Hot potato", demo: "potato",
    desc: "Whoever bought last holds the hot potato: they can't sell or send until a different wallet buys after them, which passes it on. Everyone else trades freely and buys are never blocked. A buy has to reach your minimum to pass it, and you can let it go cold after a while. Nobody is exempt, you included.",
    chips: ["last buyer is stuck", "next buyer frees them", "buys never blocked"] },
  { id: "antidump", group: "sell", name: "Anti-dump caps", demo: "antidump",
    desc: "The hook tells buys from sells and caps each side separately, so people can buy freely while no single trade can dump a big bag.",
    chips: ["max buy 2% of supply", "max sell 0.25% of supply"] },
  { id: "slidecap", group: "sell", name: "Sliding caps", demo: "antidump",
    desc: "The max per buy and max per sell change as the market cap grows. You set the caps at launch, then up to five market-cap levels where they change, for example max sell 1% at launch, 0.5% from $100,000 and 0.1% from $1,000,000, so whales have to exit in ever smaller pieces as the token grows. The hook reads the price from the token's own pool on every trade. If the market cap falls back under a level, the level below applies again. Nobody is exempt, including the creator.",
    chips: ["max sell shrinks as it grows", "up to 5 market-cap levels", "caps as low as 0.001%"] },
  { id: "sellcaps", group: "sell", name: "Graduated sell caps", demo: "sellcap",
    desc: "Small holders sell freely, but the bigger a wallet's bag, the smaller its per-sell cap, down to a floor. A whale can build a position but can't dump it in one sell. Nothing to fund and no minimum buy: the hook reads the bag straight from the sell.",
    chips: ["1% per sell for small bags", "0.1% per sell at 3%+ bags", "buys never capped"] },
  { id: "maxhold", group: "fair", name: "Max per wallet", demo: "walletcap",
    desc: "After every buy or transfer the hook checks what the receiving wallet now holds, and refuses the trade if it would go over your cap, for example 1% of supply. The Meteora pool and your own wallet are exempt. Nothing to fund and no per-wallet setup.",
    chips: ["max 1% of supply per wallet", "nothing to fund"] },
  { id: "chapters", group: "fair", name: "Chapters", demo: "chapters",
    desc: "A max per wallet that grows with the token. It starts small, for example 1% of supply, and doubles every time the total volume traded crosses another chapter, for example every 10,000,000 tokens. Selling back into the pool always works.",
    chips: ["starts at 1% per wallet", "doubles every 10M traded", "selling always works"] },
  { id: "timecap", group: "fair", name: "Rising max per wallet", demo: "timecap",
    desc: "Every wallet's max holding starts small, for example 0.1% of supply, and rises for everyone on a timer you set: a fixed step or doubling. It never stops rising, so the token opens up completely over time. Snipers can only grab a tiny bag at launch. Nothing to fund and no per-wallet setup; the pool and your wallet are exempt.",
    chips: ["starts at 0.1% per wallet", "rises every 5 minutes", "never stops rising"] },
  { id: "feecap", group: "fair", name: "Sniper-fee cap", demo: "feecap",
    desc: "Snipers win launches by outbidding everyone with huge priority fees and Jito tips. For a launch window you choose, the hook reads each buy's transaction and refuses it if it pays more than your cap. Normal buyers pay tiny fees and never notice. Sells are never blocked and your wallet is exempt.",
    chips: ["max 0.002 SOL priority fee", "max 0.002 SOL Jito tip", "first 10 minutes"] },
  { id: "guard", group: "fair", name: "Trade guard", demo: "tradecap",
    desc: "Every buy, sell and transfer is capped at the same share of supply, for example 0.5%. Anything bigger is refused inside the swap, so no whale can grab or dump a big bag in one trade.",
    chips: ["max 0.5% of supply per trade", "buys and sells"] },
  { id: "antisniper", group: "fair", name: "Anti-bundle", demo: "bundle",
    desc: "The hook counts trades in each Solana block and refuses any past your limit. A bundler packing many buys into one block gets the first few at most, so nobody can buy up the launch in a single shot.",
    chips: ["3 trades per block", "bundles refused"] },
  { id: "venuelock", group: "trade", name: "Venue-locked", demo: "venue",
    desc: "Trades only through its Meteora pool. A plain wallet-to-wallet transfer is refused, so every trade hits your official liquidity and nobody can move the token quietly off-market between wallets.",
    chips: ["pool trades only", "no wallet-to-wallet moves"] },
  { id: "dexonly", group: "trade", name: "DEX-only", demo: "dex",
    desc: "Moves only when a program moves it, like a swap on the Meteora pool. A plain wallet-to-wallet send is refused, so the token can't be passed around off-market. Buying and selling through the pool work normally.",
    chips: ["swaps only", "no wallet-to-wallet sends"] },
  { id: "fomo", group: "trade", name: "FOMO-only buys", demo: "fomo",
    desc: "It can only be bought through the FOMO app. The hook checks that FOMO's own signing wallet co-signed each buy and refuses any buy that didn't come through FOMO. Launching includes a required dev buy. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy on FOMO. This lets the dev open up the pool on FOMO, which takes a few buys to trigger. Selling and sending always work, and the rule ends when the curve graduates.",
    chips: ["buy on FOMO only", "dev wallet whitelisted", "sells never blocked"] },
  { id: "pumpapp", group: "trade", name: "Pump App only", demo: "pumpapp",
    desc: "It can only be bought in the Pump app. It can only be bought in the Pump app. The Pump app buys through Jupiter's app API and the OKX router, and the swap built for it carries a tag that jup.ag's own swaps don't; the hook refuses any buy without that tag on that router. Buying on jup.ag, in FOMO, through trading terminals like Axiom and Photon, or straight from the pool is refused. Another app built on the same Jupiter API could also get through. Launching includes a required dev buy, and the dev wallet is permanently whitelisted, so you can buy anywhere with it. Selling and sending always work, and the rule ends when the curve graduates.",
    chips: ["buy in the Pump app only", "jup.ag, FOMO and terminals refused", "sells never blocked"] },
  { id: "social", group: "trade", name: "Social trading", demo: "social",
    desc: "It only trades in FOMO or the Pump app, buying and selling. A FOMO trade is recognised by FOMO's own signature. A Pump app trade is recognised by its route: it goes through Jupiter's app API and the OKX router, and carries a tag that jup.ag's own swaps don't. Trading on jup.ag, through terminals, or straight with the pool is refused both ways. Holders have no exit outside the two apps, so if both stop trading the token nobody can sell it. Launching includes a required dev buy, and the dev wallet is permanently whitelisted. Sending between wallets always works, and the rule ends when the curve graduates.",
    chips: ["buy and sell in FOMO or the Pump app", "jup.ag and terminals refused", "no exit outside the two apps"] },
  { id: "opensea", group: "trade", name: "OpenSea only", demo: "opensea",
    desc: "It only trades on OpenSea, buying and selling. Every swap made on OpenSea carries OpenSea's own marker, and the hook refuses any trade without it, so there's no exit outside OpenSea. Launching includes a required dev buy, and the dev wallet is permanently whitelisted. Sending between wallets always works, and the rule ends when the curve graduates. OpenSea hasn't yet been seen trading a token still on its curve.",
    chips: ["buy and sell on OpenSea only", "dev wallet whitelisted", "no exit outside OpenSea"] },
  { id: "pingpong", group: "when", name: "Ping Pong", demo: "pingpong",
    desc: "Buys and sells take turns: after a buy the next trade must be a sell, and after a sell it must be a buy, for everyone, the creator included. Trades under your minimum go through on their own turn but don't hand it over, and two trades in one transaction are refused, so nobody can game it with dust. If nobody takes the turn for a while, either side can go next. Sends always work, and the token page shows whose shot it is.",
    chips: ["one buy, one sell", "nobody exempt", "token page shows the next shot"] },
  { id: "breathing", group: "physics", name: "Breathing cap", demo: "physics",
    desc: "An oscillator inside the hook swings the per-buy cap up and down on a fixed cycle, forever: wide open at the peaks, tight at the troughs. You choose the cycle, the base cap and the swing. Sells and sends are never capped, and your wallet is exempt.",
    chips: ["cap breathes on the clock", "forever, no crank", "sells never capped"] },
  { id: "momentum", group: "physics", name: "Momentum", demo: "physics",
    desc: "A damped oscillator that starts at rest. Every buy kicks it and the cap swings up with it, so a run of buying opens room for bigger buys; then it swings back and settles when trading goes quiet. Sells and sends are never capped, and your wallet is exempt.",
    chips: ["buying revs it up", "rings down when quiet", "sells never capped"] },
  { id: "resonance", group: "physics", name: "Resonance", demo: "physics",
    desc: "Momentum tuned for rhythm: buys that land in step with the natural period pile energy on and swing the cap far wider than scattered buys (5× the energy on devnet). A community buying on the beat unlocks the biggest buys. Sells and sends are never capped, and your wallet is exempt.",
    chips: ["buy on the beat", "rhythm beats volume", "sells never capped"] },
  { id: "coupled", group: "physics", name: "Coupled resonator", demo: "physics",
    desc: "Two coupled oscillators in the hook. Buys energise the first, which sets the cap, and the coupling pours that energy into the second and back, so the cap swells and fades in beats. Sells and sends are never capped, and your wallet is exempt.",
    chips: ["two oscillators", "the cap beats", "sells never capped"] },
  { id: "hours", group: "when", name: "Market hours", demo: "hours",
    desc: "Trades like a stock: only Monday to Friday, 9:30am to 4:00pm New York time. Outside the session the hook refuses the trade. You choose whether sells stay open around the clock and whether stock-market holidays are observed. Wallet-to-wallet sends always work. It can also be paired with a tokenized stock like NVDAx or TSLAx instead of SOL, so the token is priced in that stock.",
    chips: ["Mon to Fri, 9:30am to 4pm ET", "closed on market holidays", "pair with SOL or 96 stocks"] },
  { id: "custom", group: "custom", name: "Custom hook", demo: "custom",
    desc: "Your own rules, written with AI. Say what you want the token to do; the AI writes it as a short rule set, checks it with the real compiler and tests it, and you can edit every line. Rules can use the trade, each wallet's own buys and sells, the clock in any time zone, the market cap, fees and the app a trade came from. Stored on-chain at launch, fixed for good, and it still trades on any DEX.",
    chips: ["describe it, AI writes it", "tested before you launch", "trades on any DEX"] },
  { id: "editable", group: "custom", name: "Editable hook", demo: "custom",
    desc: "A Custom hook that is never locked. Launch with any rules (or none) and rewrite them whenever you like with the same AI builder: only your wallet can make a change, each one is made on-chain, and the token's page always shows the rules as they are right now. 5% of the token's trading fees goes into its own fund that pays for the AI work; 80% still goes to the Hooked buyback and burn. Normal 1% fee, and it trades on any DEX.",
    chips: ["change the rules any time", "only your wallet can", "trades on any DEX"] },
  { id: "dao", group: "custom", name: "DAO hook", demo: "custom",
    desc: "A Custom hook run by its holders. Wallets holding the minimum you set post ideas for the rules and vote them up or down. When an idea reaches the votes you set, AI writes it as rules, tests it, and Hooked's keeper puts it on-chain. Nobody can change the rules any other way, including you. 5% of the token's trading fees goes into its own fund that pays for the AI work and the changes; 80% still goes to the Hooked buyback and burn. Normal 1% fee, and it trades on any DEX.",
    chips: ["holders vote on the rules", "AI writes what passes", "trades on any DEX"] },
  { id: "king", group: "paid", name: "King of the Hill", demo: "king",
    desc: "The largest qualifying buy holds the crown. Beat the King's winning buy in a single buy and you steal it; the bar slowly decays so the throne never becomes unreachable. While they hold the crown the King earns about 0.5% of every trade, paid in SOL by the program itself, and selling or sending any tokens gives it up. The token page shows the King, the reign and a Hall of Kings. Trades carry a 1.65% fee, and it trades on any DEX.",
    chips: ["biggest buy takes the crown", "the King earns from every trade", "trades on any DEX"] },
  { id: "conviction", group: "fair", name: "Conviction cap", demo: "conviction",
    desc: "Every wallet starts with a small limit per buy. Each minute, hour or day it holds without selling (you choose), its own limit climbs, up to a ceiling you set; sell and that wallet's clock starts again. New money is throttled while proven holders can buy bigger. Sells are never capped, your wallet is exempt, and it trades on any DEX.",
    chips: ["buy cap grows as you hold", "selling resets it", "trades on any DEX"] },
  { id: "schedule", group: "when", name: "Trading hours", demo: "schedule",
    desc: "You set the trading week: which days it trades and the hours on each, in any time zone in the world, with daylight saving followed on-chain. Outside those hours the hook refuses the trade. A day can run past midnight or stay open all day, and you choose whether sells stay open around the clock. Wallet-to-wallet sends always work.",
    chips: ["your days, your hours", "any time zone", "daylight saving handled"] },
  { id: "p2p", group: "trade", name: "P2P-only", demo: "p2p",
    desc: "The opposite of Venue-locked: it moves only wallet to wallet, and nobody can buy or sell it on a market. Only you can buy from the bonding curve, even all of it, and hand tokens out. When the curve fills up it graduates, the rule switches off, and it trades normally.",
    chips: ["wallet to wallet only", "you can buy the curve", "rule ends at graduation"] },
  { id: "airdrop", group: "paid", name: "Buyer rewards", demo: "airdrop",
    desc: "Fill a vault with any token or with NFTs. Every qualifying buy earns the buyer a reward, which they collect on Hooked, even if they've never held that token. Buys only earn while the vault can cover them. You can withdraw anything not already owed to buyers.",
    chips: ["tokens or NFTs", "buyers collect on Hooked", "withdraw what isn't owed"] },
  { id: "tithe", group: "paid", name: "Tithe", demo: "tithe",
    desc: "The same enforcement as a royalty, but the payment goes to a cause you name: a charity, a treasury, a public-goods fund.",
    chips: ["0.005 SOL per trade", "to an address you pick"] },
  { id: "reactive", group: "link", name: "Reactive pair", demo: "reactive",
    desc: "Two tokens that watch each other. Each one's per-buy cap loosens while the other is being bought and tightens while it's being sold, so momentum in one opens the door in the other. Sells are never capped. Launch the two together.",
    chips: ["cap moves with its partner", "sells never capped", "launch as a pair"] },
  { id: "capentangled", group: "link", name: "Entangled", demo: "entangled",
    desc: "Stays locked until its Beacon token's market cap reaches the target you set, for example $20,000. Then it unlocks for good, even if the Beacon falls back later. Launch the two as a pair.",
    chips: ["unlocks at a market cap", "permanent unlock", "launch as a pair"] },
  { id: "capbeacon", group: "link", name: "Beacon", demo: "beacon",
    desc: "Trades freely with no cap. Its hook remembers the highest market cap it has reached, and hitting the target is what unlocks its Entangled partner.",
    chips: ["no cap", "tracks its market cap"] },
];

const entry = (id: string) => catalog.find((c) => c.id === id) as CatalogEntry;
const anyVenue = (c: CatalogEntry) => c.venue !== "client";
const labGroup = (f: Family) => LAB_FAMILIES.find((l) => l.family === f)?.group ?? "link";

export const VERIFIED_RULES: Rule[] = VERIFIED.map((v) => {
  const c = entry(v.id);
  // Airdrop is tested end to end on devnet but not yet through a live Meteora swap. The
  // market-cap Beacon/Entangled pair was proven with real Meteora trades (scripts/e2e-capgate.mts).
  // FOMO-only buys: proven on mainnet with real buys through the FOMO app.
  const fresh = v.id === "airdrop" || v.id === "pumpapp" || v.id === "timecap" || v.id === "feecap" || v.id === "hours" || v.id === "slidecap" || v.id === "social" || v.id === "opensea" || v.id === "pingpong" || v.id === "breathing" || v.id === "momentum" || v.id === "resonance" || v.id === "coupled" || v.id === "pegs" || v.id === "potato" || v.id === "blocklist" || v.id === "schedule" || v.id === "custom" || v.id === "conviction" || v.id === "king" || v.id === "editable" || v.id === "dao";
  return { ...v, anyVenue: anyVenue(c), verified: !fresh, fresh, family: c.family as Family, program: c.program };
});

export const LAB_RULES: Rule[] = catalog
  .filter((c) => !VERIFIED.some((v) => v.id === c.id) && !HIDDEN_RULE_IDS.has(c.id))
  .map((c) => {
    const family = c.family as Family;
    return {
      id: c.id,
      name: c.name,
      group: labGroup(family),
      demo: family === "Rewards" || family === "Emission" ? "reward" : "gate",
      anyVenue: anyVenue(c),
      desc: c.blurb,
      chips: c.chips,
      verified: false,
      fresh: false,
      family,
      program: c.program,
    } satisfies Rule;
  });

/** Verified first, then the lab in family order. */
export const RULES: Rule[] = [
  ...VERIFIED_RULES,
  ...LAB_FAMILIES.flatMap((l) => LAB_RULES.filter((r) => r.family === l.family)),
];

/** Offered rules only. */
export const ruleById = (id: string) => RULES.find((r) => r.id === id);
/** Any rule's display name, including retired ones, for tokens already launched with them. */
export const ruleNameOf = (id: string) => ruleById(id)?.name ?? catalog.find((c) => c.id === id)?.name ?? id;

/** The live devnet token shown on the home page. */
