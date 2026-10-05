# Launch Ideas — grounded in what transfer hooks can actually do

Concrete token-launch concepts built **only** from capabilities proven on devnet
in [`FINDINGS.md`](./FINDINGS.md) (including live Meteora DBC swaps). Each idea
lists the capabilities it uses, how it works, the honest catch, and Meteora fit.
Nothing here relies on something we haven't tested.

## A. Fair-launch protection (validators — simplest, safest, ship-today)

### 1. Auto-tightening anti-whale ("The Vise")
- **Uses:** max-holding % (Batch 1) + cumulative volume (Batch 2).
- **How:** whale cap starts loose and ratchets **down** as lifetime volume grows —
  fairness compounds and never loosens.
- **Catch:** taken too far it approaches non-transferable; needs a sane floor.
- **Meteora:** ✅ enforces on every swap.

### 2. Chapters ("the coin grows up")
- **Uses:** unique-holder count (Batch 2) + live reconfig of the cap (Batch 8).
- **How:** the whale cap loosens automatically as the holder base crosses
  milestones (500 → 2k → 10k holders). A shared, visible community goal.
- **Catch:** milestones are best keyed to holders (hard to fake) not trade count
  (wash-tradeable); permanent once unlocked.
- **Meteora:** ✅ each milestone change takes effect on the next swap.

### 3. Anti-sniper launch window
- **Uses:** time-lock + per-slot rate limit (Batches 1, 6).
- **How:** for the first N minutes, cap per-wallet size and cap trades-per-slot, so
  snipers/bundlers can't dominate the open. Loosens on a schedule.
- **Catch:** the per-slot limiter is a griefing surface (cheap spam can exhaust the
  slot budget) — scope it per-source in production.
- **Meteora:** ✅.

### 4. Compliance / allowlist token
- **Uses:** allowlist or blacklist (Batch 1).
- **How:** only KYC'd / approved wallets can receive; or a permanent bot kill-list.
- **Catch:** a mutable list is a trust surface — publish who controls it, or freeze
  it. Narrows tradability (allowlist tokens won't route on open venues).
- **Meteora:** ✅ (as long as the pool authorities are exempted, as our CappedPad
  hook does).

---

## B. Market-reactive & accountability (sensors + CPI)

### 5. On-chain buy/sell flywheel
- **Uses:** buy/sell provenance (Batch 4) + side-token burn (Batch 3).
- **How:** the hook tallies buys vs sells on-chain; a crank buys back and burns a
  side token proportional to sell pressure ("dump-catcher"). Provenance also lets
  behavior differ for buys vs sells.
- **Catch:** the hook records; the actual buyback is a script funded by fees — a
  verifiable commitment, not enforced. Market it honestly.
- **Meteora:** ✅ fires on both sides.

### 6. The honest odometer / "coin's memory"
- **Uses:** counters, volume, holders (Batch 2).
- **How:** the token keeps a permanent, unfakeable public record — total volume,
  trade count, unique holders, biggest trade — that a site reads live.
- **Catch:** pure transparency layer, no price effect. Best as a garnish on another
  mechanic.
- **Meteora:** ✅.

### 7. Deflationary-on-trade token
- **Uses:** side-token mint/burn (Batch 3).
- **How:** every trade burns a fixed amount of a paired "points"/reward token (or
  mints it to a vault for later distribution). Trading literally changes supply.
- **Catch:** must be a **side** token (can't burn the traded coin itself); minted =
  infinite, transferred/burned from treasury = finite.
- **Meteora:** ✅. **On-chain distribution is built** — `distrib` mode 1 (scarcity
  buyback-burn: anyone burns the vault above a floor) or mode 0 (stake/claim). (Batch 34)

## C. Reward & gamified (self-funded drips + CPI)

### 10. Proof-of-trade points / loyalty
- **Uses:** accumulators + side-token mint (Batches 2, 3).
- **How:** trading mines a separate points token (minted to a global vault, or to
  holders via the manna pattern). Points → governance, airdrops, tiers.
- **Catch:** per-wallet on-chain accrual needs the self-funded-slot trick or an
  off-chain snapshot; a global vault + **on-chain stake/claim** (Batch 34, `distrib`
  mode 0) is now the simplest fully-on-chain route (no merkle, no crank).
- **Meteora:** ✅ (accrual is mint-keyed; claim is off the swap path).

### 11. Trade-triggered jackpot
- **Uses:** provenance + fixed-capacity registry (Batches 2, 4) + side-token payout.
- **How:** each buy enters the buyer into a rolling ring buffer; a crank draws a
  winner and pays a side-token pot.
- **Catch:** sybil (cheap self-buys farm the draw) — needs a min buy size + per-slot
  entry cap; a fixed registry has a hard capacity.
- **Meteora:** ✅.

---

## D. Novel / experimental (further out)

### 12. Diamond-hand scoreboard
- **Uses:** provenance (buy vs sell) + per-holder state.
- **How:** record entry slot on buy, exit on sell; accrue a hold-time score; a crank
  rewards top scores. Paper hands are recorded selling as surely as diamonds hold.
- **Catch:** per-holder records hit the fixed-capacity / account-creation wall;
  works cleanly only for a bounded holder set or via off-chain reconstruction.

### 13. Amount-tiered behavior
- **Uses:** amount-dependent account resolution (Batch 5) + tier state.
- **How:** route each trade to a per-size "tier" account chosen by the transfer
  amount — different rewards/rules for shrimp vs whale trades.
- **Catch:** every tier account is an extra account (budget tax); tiers must be
  pre-created.

### 14. Self-regulating decentralization meter
- **Uses:** unique-holder count + live cap (Batches 2, 8).
- **How:** the whale cap **loosens** as the holder base widens — brutal anti-whale
  when small, roomy when broad, never fully off (on an infinite curve).
- **Catch:** you can count entries but not cheap exits, so the holder number is
  *cumulative* (overstates real distribution) — say so.

### 15. Permanent, un-ruggable rule set
- **Uses:** any validator + **revoked hook authority** on an infinite curve.
- **How:** launch with the rules you want, then revoke the config/hook authority so
  they can never change, on a curve that never migrates so the hook never lifts.
  Maximum credibility: the rules are provably permanent.
- **Catch:** truly irreversible — a bug is forever; and the token only trades on
  hook-aware venues for its whole life.

---

## E. New ideas from the deeper findings (Batches 9–16)

### 16. On-chain lottery / jackpot token (trustless)
- **Uses:** SlotHashes randomness (Batch 13) + classic-SPL side-token payout (Batch 3)
  + provenance to enter only buyers (Batch 4).
- **How:** every buy draws a pseudo-random number from SlotHashes *inside the hook*;
  on a hit, the hook mints/transfers a classic-SPL prize (or records a winner a crank
  pays). No off-chain RNG needed — the draw is on-chain.
- **Catch:** SlotHashes is validator-influenceable at the margin — fine for memecoin
  jackpots, **not** for high-stakes fairness. Prize token must be classic SPL.
- **Meteora:** ✅ fires on every buy.

### 17. Cross-program trigger token
- **Uses:** arbitrary CPI (Batch 15).
- **How:** every trade pings another program — update a leaderboard, bump an
  on-chain game, write a Memo for indexers, poke your own logic. The token becomes
  an *event source* other programs subscribe to.
- **Catch:** each CPI adds accounts + compute (mind the ~10-account budget); the
  called program must tolerate being invoked from a hook (no instruction-sysvar
  caller checks). Cannot be Token-2022.
- **Meteora:** ✅.

### 19. Fee-and-logic token (extensions stacked)
- **Uses:** transfer fee + hook composition (Batch 11).
- **How:** a real, protocol-enforced transfer fee (collectable via Token-2022)
  **plus** a hook for behavioral logic — the fee funds treasury/buybacks, the hook
  does anti-whale / provenance / points. Best of both: enforced economics + custom
  rules, and the hook sees the net (post-fee) amount.
- **Catch:** a transfer fee narrows DEX/aggregator support just like a hook does;
  size it deliberately.
- **Meteora:** ✅ (both extensions active on the same mint).

### 21. Self-scoped anti-bundler launch
- **Uses:** per-slot **buy** cap (Batch 12, capstone `mhook`).
- **How:** cap buys-per-slot so atomic bundlers can't sweep the open, but leave
  sells and wallet moves unthrottled (scoped to buys via provenance) — a cleaner
  anti-snipe than a global per-slot limit.
- **Catch:** still a mild griefing surface (cheap buys can eat the slot budget);
  pair with a min buy size.
- **Meteora:** ✅ (buy = source is the DBC pool authority `FhVo3mqL…`).

### 22. Heartbeat / "ping" mechanics
- **Uses:** 0-amount transfers fire the hook (Batch 13).
- **How:** a 0-token self-transfer is a free, valueless way to *trigger* the hook —
  advance a timer, claim-tick, refresh state, or check in — without moving value.
- **Catch:** because anyone can ping for free, state that a ping mutates must be
  safe against spam (idempotent / rate-limited).
- **Meteora:** n/a (this is a wallet-level primitive, not a swap).

### 23. The market-reactive reference token (`mhook`)
- **Uses:** composition — provenance + per-side volume + per-slot buy cap in ONE hook
  (Batch 12), proven live on Meteora.
- **How:** a launchable template that does real on-chain market accounting (buys,
  sells, volume) and light protection, all in a single hook with one extra account.
  Bolt on a crank that reads the on-chain buy/sell tallies to drive buybacks/reflections.
- **Catch:** the hook records; value moves via a crank (classic-SPL or fees). Keep
  the extra-account count at 1–2.
- **Meteora:** ✅ (this idea *is* the Batch-12 capstone).

---

## F. More ideas from the deep-edge findings (Batches 17–19)

### 24. Membership-gated / ecosystem token
- **Uses:** holder-gated transfers (Batch 19).
- **How:** the token can only be **received by wallets that already hold** your gate
  token or NFT ("must hold the pass to hold the coin"). Builds a closed ecosystem,
  a loyalty tier, or a soulbound-to-community asset — without maintaining an address
  allowlist (membership is just "do you hold X").
- **Catch:** narrows tradability hard (open buyers without the gate token can't
  receive → won't route on general venues); the recipient's gate account must exist
  at resolution time. Best for closed/community tokens, not open memecoins.
- **Meteora:** ⚠️ works only if buyers already hold the gate token — so this suits a
  gated pool / community launch, not a public curve.

## Correction (Batch 23): on-chain storage in a hook is NOT fixed-capacity

Earlier ideas warned that per-holder registries hit a "fixed-capacity" wall. That
was based on an inconclusive result later **overturned**: a hook **can `realloc`
(grow) its own account** during a transfer (Batch 23). So append-only logs and
growable registries are viable — pre-fund the account with a lamport buffer at init
(no payer is available at transfer time). This relaxes the catches on the **jackpot
(#11)**, **diamond-hand scoreboard (#12)**, and **proof-of-trade points (#10)**
ideas: growable on-chain state is an option, not just fixed arrays or off-chain
snapshots. (The separate limit still holds: a hook can't *create a brand-new
account* for a fresh wallet without a funded system-owned payer — growing an
existing program-owned account is what works.)

---

## G. New ideas from the extension + deep-edge findings (Batches 27–29)

### 26. Taxed token with a smart war-chest ("tax + brain")
- **Uses:** Transfer Fee extension (Batch 27) + provenance/accumulator hook (Batches 2, 4).
- **How:** a real protocol-enforced % tax funnels to a treasury (verified: 5% → treasury),
  while the hook does the *smart* part — tags buys vs sells, tallies volume on-chain,
  and a crank spends the tax war-chest on buybacks/reflections/rewards.
- **Why people buy:** "taxed with a purpose" — the fee visibly funds buybacks/rewards,
  not just a dev wallet, and the on-chain tally makes it credible.
- **Catch:** the tax is the fee *extension*, not the hook (the hook can't skim the coin);
  a fee narrows DEX support like a hook does — size it deliberately.
- **Meteora:** ✅ both fire on every swap.

### 27. Compliance / KYC token ("approved wallets only")
- **Uses:** DefaultAccountState=Frozen + freeze authority + hook (Batch 29).
- **How:** every new account is **frozen by default**; you thaw (approve) verified
  wallets, and the hook layers on rules (limits, provenance). A real regulated-asset /
  gated-community pattern with no maintained on-chain allowlist inside the hook.
- **Why buy:** appeals to RWA / regulated / members-only issuers, not memecoin crowds.
- **Catch:** frozen-by-default = not openly tradable (you gate every holder) — a feature
  for compliance, a killer for open speculation. The freeze authority is a trust point.
- **Meteora:** ⚠️ only works if the pool/holders are pre-approved (gated launch, not a public curve).

### 28. Clawback / moderated token ("undo the scam")
- **Uses:** PermanentDelegate + hook (Batch 28).
- **How:** a designated delegate can move/burn anyone's tokens — so a mod/DAO can
  reverse a hack, claw back a scam, or enforce game rules; the hook adds the live logic.
- **Why buy:** games, communities, and "safe" tokens where reversibility is a selling
  point ("stolen tokens can be returned").
- **Catch:** **major trust flag** — the delegate can seize *any* holder's tokens. Only
  works if the delegate is a credible DAO/multisig, and it must be disclosed loudly.
- **Meteora:** ✅ (but the permanent delegate will scare speculative buyers).

### 29. Living leaderboard token (growable on-chain hall-of-fame)
- **Uses:** self-realloc (Batch 23) + provenance/accumulator (Batches 2, 4).
- **How:** the hook maintains an **unbounded, ever-growing on-chain record** — top
  buyers, biggest trades, a diamond-hand ranking — that grows with the community and
  a site renders live. Not a fixed ring buffer; it genuinely accretes.
- **Why buy:** status/flex mechanics ("be on the permanent on-chain leaderboard"),
  screenshot-friendly, gives a reason to trade bigger.
- **Catch:** pre-fund the account's lamport buffer for growth; keep per-transfer writes
  cheap (CU budget); it's a status layer, pair it with a value mechanic.
- **Meteora:** ✅.

## ⚠️ Meteora DBC tradability correction (from FINDINGS Batch 31)

Verified each hook type on live Meteora swaps. **A hook only works on Meteora if its
extra accounts use simple/static seeds** (Literal, AccountKey, fixed pubkeys) — even
many of them, even with a CPI. **Hooks that resolve an account from another account's
DATA at transfer time** (an `AccountData` seed → external-PDA, e.g. "the recipient's
ATA of token X") **FAIL** in Meteora's swap resolver (`TokenTransferHookInvalidSeed`),
even though they work on raw transfers.

**This changes the Meteora verdict on two idea classes:**
- **Hands-off reward drip (#9) / proof-of-trade points to holders (#10):** the drip
  derives the recipient's reward ATA via external-PDA resolution → **does NOT resolve
  through Meteora's swap tooling.** So the "rewards appear on every Meteora buy" pitch
  is **not** currently true via the standard swap path. **On-chain, hook-only alternatives:**
  (a) **scarcity via on-chain buyback-burn** (accrue per-mint, burn to raise everyone's
  value — no per-recipient distribution), or (b) **per-mint global reward vault + an
  on-chain CLAIM instruction** holders call themselves. Not a per-buyer auto-drip, not
  a frontend.
- **Membership-gated / holder-gated token (#24):** relies on the same dynamic
  external-ATA resolution → **not Meteora-DBC-tradeable** via the standard swap. Fine
  for closed/frontend-controlled flows only.

**Unaffected (confirmed working on Meteora):** all validator ideas (anti-whale, caps,
locks, pause, blacklist/allowlist-by-key), accumulators (odometer, volume, holder
count), provenance (buy/sell flywheel, dump-catcher), the composed market-reactive
reference (#23/mhook), taxed-token via the fee extension (#26/tax), and **CPI-to-a-
side-token** (deflation/mint-to-vault, #7) — these use simple seeds and are proven on DBC.

---

## H. Five NEW mechanics — verified devnet + Meteora (FINDINGS Batch 33)

All fully on-chain, hook-only, Meteora-DBC-tradeable (mint-keyed seeds), reward side
accrues to a global vault (on-chain claim / buyback-burn — no frontend needed).

### 31. Self-loosening cap token ("chapters, on-chain")
- **Mechanic:** max-holding cap **doubles** each time cumulative volume crosses a
  threshold — fairness relaxes as the token matures, automatically, no dev action.
- **Why buy:** a visible, shared "the coin grows up" narrative; brutal anti-whale
  early, free later. `evolve` program, proven on Meteora (volume counter advances on a buy).

### 32. Self-tightening cap token ("the vise")
- **Mechanic:** cap **shrinks over time** toward a floor (Clock-driven) — diamond-hand
  pressure that compounds.
- **Why buy:** scarcity/discipline narrative. **Catch:** taken far it approaches
  non-transferable — set a sane floor.

### 33. Halving-emission token ("on-chain mining")
- **Mechanic:** every trade mints a **halving** amount of a paired reward token to a
  global vault (emission decays over epochs, Bitcoin-style).
- **Why buy:** "early trades mine more" — a real reason to get in early. Reward
  distributes via on-chain claim / powers a buyback. Proven minting on a Meteora buy.

### 34. Reactive dump-catcher token (fully on-chain)
- **Mechanic:** on every **sell** the hook **burns** a % of a paired token from the
  vault — in the hook, no crank. The token literally fights dumps on-chain.
- **Why buy:** self-defending / deflationary-on-sell narrative that's actually
  enforced on-chain (proven: buy → no burn, sell → burns 1% of the trade).

### 35. On-chain jackpot-accrual token (RNG)
- **Mechanic:** SlotHashes randomness — ~10% of trades mint a **10× bonus** of the
  reward token, the rest 1× (proven live: `[10,10,1,10,1,1,1,1]`).
- **Why buy:** gambling dopamine, provably-fair on-chain draw, screenshot-friendly.
  The strongest pure buy-magnet — and it's real, tested, and Meteora-compatible.
- **Catch:** SlotHashes is validator-influenceable at the margin → memecoin-scale only.

---

## E. Entangled tokens (coupled hooks — new frontier, Batch 35, `twin`)

The hook reacts to *another token's* live on-chain state, or publishes its own as a
feed. All coupling is via **global-state pubkeys** (fixed extra accounts) → **Meteora-
tradeable**, unlike per-recipient holder-gating. **Proven live on Meteora** (Batch 35,
#82): a real DBC buy of A was vetoed while B was locked, then succeeded once B traded
past the threshold — nothing about A changed, only the sibling moved.

### 27. Reactive pair / the hedge (continuous, not binary)
- **Uses:** reactive coupling — a cap that slides with a sibling's pressure (Batch 36, `pulse`).
- **How:** two paired tokens; token A's per-trade cap (or whale-limit/fee) **slides
  continuously** with partner B's live net buy pressure — loosens as B is accumulated,
  tightens as B is dumped. A lead/lag or hedge relationship enforced on-chain, no crank.
  (The binary version — A auto-*halts* when B crosses a line — is the same read, mode-2
  `twin`, Batch 35.)
- **Catch:** expose the coupling curve transparently; a floor/cap keeps it from degenerating
  to non-transferable; the pressure metric is wash-tradeable like any volume number.
- **Meteora:** ✅ **proven live** (#84) — the same DBC buy of A was vetoed while B was flat,
  then allowed after B was bought up.

### 28. The token *is* the oracle
- **Uses:** hook-published feed consumed by a **separate** program (Batch 36, `harvest`, #85-86).
- **How:** the coin's hook maintains a trade-driven metric (volume, buy/sell pressure,
  holder count) in a public PDA; **any** unrelated program — a yield vault, another token's
  hook, a dashboard contract — reads it as a live feed. Proven: a standalone `harvest`
  program mints a yield token proportional to a coin's live buy-pressure, fed by real
  Meteora buys. No external oracle; the memecoin's own trading *is* the data source.
- **Catch:** it's a raw on-chain metric (wash-tradeable) — good for coordination/composition
  and gamified yield, not a price you'd secure real value against.
- **Meteora:** ✅ **proven live** (#86) — a real Meteora buy raised the feed and the separate
  program minted exactly-proportional yield from it.

### 29. Index / basket token
- **Uses:** multi-sibling aggregation (Batch 37, `basket`, #87-88).
- **How:** a token whose rule tracks a **basket** of others — its cap (or fee/whale-limit)
  loosens with the *aggregate* net buy pressure of {B,C,D,…}, so it moves with a whole
  sector, not any single coin. A "sector index" or "ecosystem token" that reflects the
  group's momentum on-chain.
- **Catch:** each basket member is one extra account (mind the ~10-extra swap budget, so
  ~6-8 members max); members are wash-tradeable like any volume metric; pick sum vs
  average deliberately.
- **Meteora:** ✅ **proven live** — N sibling feeds resolve inside the swap.

### 30. Reflexive pair / coupled twins
- **Uses:** mutual feedback coupling (Batch 37, `pulse`×2, #89-91).
- **How:** two tokens each reactive to the other — buying one loosens the other, a virtuous
  (or vicious) cycle enforced on-chain. Reads-only, so no recursion; a launch pair that
  "pumps together" or a lead/lag structure where the follower unlocks as the leader trades.
- **Catch:** **keep a nonzero base cap** — a zero-base mutual coupling deadlocks permanently
  (neither can build the pressure to loosen the other). Design the bootstrap path explicitly;
  reflexivity cuts both ways (a dump in one tightens the other).
- **Meteora:** ✅ **proven live** — both arms closed on real DBC trades.

### 31. Weighted index token
- **Uses:** weighted multi-sibling aggregation (Batch 38, `windex`).
- **How:** a token that tracks a **weighted** basket — each member carries a coefficient, so
  it can mirror a real index (60/30/10, market-cap weights, a curated sector). The heavy
  members move its rule several times harder than the light ones.
- **Catch:** each member is an extra account (~6-8 max in a swap); weights are fixed at launch
  (a `set_weights` could make them tunable); members are wash-tradeable like any volume metric.
- **Meteora:** ✅ **proven live** — a light-member buy left A's cap below the trade, a
  heavy-member (weight 3) buy crossed it, inside the swap.

### 32. Coupled token ring / reflexive chain
- **Uses:** three-body ring coupling (Batch 38, `pulse`×3, #92-93).
- **How:** a small family of tokens each keyed to the next (A→B→C→A). Activity anywhere
  propagates a loosening wave around the ring — a coordinated launch cohort where trading
  one member gradually opens the others. Proven live: bootstrapping one unlocked another
  **two hops away** on a real Meteora buy.
- **Catch:** monotonic coupling → a stable one-way wave (no oscillation); keep a **nonzero
  base at every node** or the ring can't bootstrap (a single zero-base node stalls it).
- **Meteora:** ✅ **proven live** — the wave propagated through a live swap.

## Stability note (Batches 36-39)

Coupled-token behavior maps cleanly onto one axis:
- **Monotonic coupling** (buying a sibling *loosens* this token) → stable **one-way loosening
  waves**; feedback loops and rings propagate and settle, never oscillate (Batches 36-38).
- **Inverse coupling** (buying a sibling *tightens* this token) → **anti-correlated suppression**;
  a mutual inverse pair is a **driven latch** — control flips only on external pump/dump (Batch 39).
- **Autonomous oscillation is not achievable** with transfer-driven, per-direction-monotonic hook
  state: nothing evolves between trades and no internal variable overshoots/reverses on its own.
  A true on-chain oscillator would need an internal integrator advanced by `Clock` on every transfer.

### 37. Paired resonators / beat token (coupled oscillators)
- **Uses:** two coupled oscillators — beats & normal modes (Batch 43, `coupled`, #107-109).
- **How:** a token with two internal "momentum" modes whose energy sloshes between them on a
  beat (proven: a full 98/2 → 1/99 → 98/2 cycle live on Meteora), or a coordination game keyed to
  a normal mode (symmetric = buy both in phase; antisymmetric = the faster mode). The breathing
  cap can track either oscillator, so capacity ebbs and flows on the beat.
- **Catch:** genuinely subtle — this is a physics demo more than a fairness mechanic; needs
  careful `ω/k` tuning and a UI to make the beat legible to traders.
- **Meteora:** ✅ **proven live** — a full beat cycle sampled by real Meteora buys.

---

## I. Composite launches — combining the full toolkit (Batches 34-43)

The single-primitive ideas above are the alphabet; these are words. Each combines several
proven capabilities into one launch. All building blocks are chain-verified (devnet + live
Meteora); a given *combination* would still want its own end-to-end integration test before
mainnet, but nothing here relies on an unproven capability.

### 38. Living index fund ("sector ETF with a dividend")
- **Uses:** weighted basket (`windex`, #87-88) + on-chain reward distribution (`distrib`, #75-77).
- **How:** a token whose cap/behavior tracks a **weighted basket** of partner coins (a "DeFi
  sector index"), *and* whose hook fills a global reward vault on every trade that **stakers
  claim pro-rata**. Hold + stake the index → earn a dividend sourced from the whole sector's
  trading. One token = exposure to a basket + a yield stream, fully on-chain.
- **Catch:** basket members are wash-tradeable metrics; each member is an extra account (~6-8 max);
  the "dividend" is a side token, not the basket coins themselves.
- **Meteora:** ✅ both halves proven live (index enforcement in-swap; claim off-swap).

### 40. Proof-of-liveness rewards ("earn only while it's alive")
- **Uses:** driven-damped oscillator (`dosc`, #102-104) + reward distribution (`distrib`).
- **How:** the token's reward emission is gated by its **oscillator amplitude** — rewards flow
  only while the coin is being *actively, rhythmically* traded, and taper off (ring-down) as
  trading stalls. A dead community earns nothing; a living one keeps the flywheel spinning. Kills
  passive reward-farming and makes "liveness" an on-chain, self-enforcing condition.
- **Catch:** genuinely stops paying in quiet markets (a feature, but set a floor so it doesn't
  hard-zero); amplitude is drivable by a whale, so cap the per-trade kick.
- **Meteora:** ✅ forcing + ring-down proven live (Batch 41).

### 42. Rotation pair (an on-chain pairs-trade)
- **Uses:** mutual inverse coupling (`inv`, #98).
- **How:** two paired tokens wired inverse-to-each-other so **capital naturally rotates** — as A
  pumps, B's cap tightens (harder to pile into both), and vice versa. The duo self-rebalances;
  buying the laggard is always the easier trade. A "pairs-trade" primitive as a token couple, or a
  built-in rotation between a project's two assets.
- **Catch:** it's a *driven latch*, not magic — only one side is freely tradeable at a time, and
  someone must trade to flip it; keep a floor so neither side ever fully freezes.
- **Meteora:** ✅ mutual-inverse enforcement proven live (Batch 39).

### 44. Scheduled sell-window (autonomous cooldown)
- **Uses:** autonomous oscillator (`osc`, #99-101) + buy/sell provenance (`phook`, Batch 4).
- **How:** **buys always allowed; sells only during the oscillator's "open" phase** — a periodic,
  clock-driven sell window that opens and closes on a fixed cadence, forever, with no crank and no
  authority. Throttles coordinated dumping into scheduled windows (calmer troughs, open peaks)
  while never blocking entry — a self-running, unstoppable cooldown.
- **Catch:** a *ban*-style sell throttle can frustrate holders and won't route on venues that
  reject conditional sells; the schedule is public so it's a soft speed-bump, not a lock. Best on
  an infinite curve where the rule is permanent.
- **Meteora:** ✅ oscillator-gated transfers proven live (Batch 40); sell-detection proven (Batch 4/12).

### 47. On-chain vesting airdrop (per-wallet cliffs, no multisig)
- **Uses:** per-holder vesting (`drip` mode 1, #150) + lazy slots.
- **How:** distribute to a community or cap table; each wallet's tokens unlock on *its own* clock
  from first receipt (cliff, then linear), and it can only ever sell its vested share — enforced
  in the swap, per holder. Team/investor/airdrop locks with no vesting contract and nothing to
  trust.
- **Catch:** sells fail on a stock aggregator (a feature — sells only via the honest client, or
  unlock fully first); a too-aggressive schedule frustrates real holders.
- **Meteora:** ◑ client, proven live (Batch 55).

### 48. Anti-dump launch (loose buys, tight sells)
- **Uses:** buy/sell asymmetry (`asym`, #148).
- **How:** a high per-*buy* cap and a tight per-*sell* cap, read from trade provenance against the
  pool authority. Whales can accumulate but can't exit in size in one trade — a structural,
  in-swap anti-dump a router can't dodge.
- **Catch:** determined sellers split across many trades (slows, doesn't stop); a too-tight sell
  cap thins liquidity.
- **Meteora:** ✅ verified (mint-keyed), proven live (Batch 54).

### 49. Loyalty-points token (per-buyer reward, minted on claim)
- **Uses:** token dividends (`drip` mode 2, #152).
- **How:** every buy accrues a branded reward token to the buyer's slot; a claim mints it. A
  per-holder loyalty program welded to the coin — points you actually own and can redeem or
  trade, funded by emission rather than a pool.
- **Catch:** the reward supply inflates (cap it or halve it like `emit`); a bot farms points, so
  tie value to *holding*, not buying; client-route.
- **Meteora:** ◑ client, proven live (Batch 56).

### 50. Enforced-royalty collectible (the WEN debate, settled)
- **Uses:** royalty enforcement (`gatekeep` mode 1, #144) + Instructions sysvar (Batch 22).
- **How:** a low-supply / 0-decimal token whose hook rejects any transfer that doesn't pay the
  creator's royalty **in the same transaction** — verified from the sysvar. On-chain,
  unavoidable, no marketplace cooperation required; the royalty lives in the transfer path.
- **Catch:** the sender's client must attach the royalty payment (wallets/marketplaces need the
  format) — works on secondary transfers and the Lattice route, not a bare DBC swap.
- **Meteora:** ⚠️ transfer-path enforcement; proven on direct transfers (Batch 52).

### 51. Allowlist presale (Merkle proof, no presale contract)
- **Uses:** Merkle allowlist (`gatekeep` mode 2, #145) + sibling memo.
- **How:** only wallets in your Merkle root can receive; the buyer attaches a proof in a sibling
  SPL-memo the hook verifies against the root. Gate a whitelist/presale with a single 32-byte
  root — no separate presale program, no per-wallet on-chain registration.
- **Catch:** the proof rides a memo (UTF-8 hex) that the buyer's client must add → Lattice-route
  / custom client; rotating the list means a new root (needs a setter).
- **Meteora:** ⚠️ needs the proof ix in the tx; proven on direct transfers (Batch 52).

### 52. Venue-locked token (trade only where you allow)
- **Uses:** venue allowlist (`gatekeep` mode 0, #143) + Instructions sysvar.
- **How:** reject any transfer whose transaction doesn't also touch your named program — your
  DEX, your router, your escrow. Force all trading through a venue you control, for fee capture,
  compliance, or an official-pool-only launch.
- **Catch:** whatever program you name becomes mandatory — lock only to a real, liquid venue;
  wallet-to-wallet moves fail unless they include it.
- **Meteora:** ✅ when the venue is the DBC/DEX program buyers already route through; proven live
  (Batch 52).

### 55. Whale-graduated sell limits (progressive per-wallet cap)
- **Uses:** per-holder cumulative tally (`hold`, #91) + buy/sell provenance (`asym`).
- **How:** the more a wallet has accumulated, the tighter its per-*sell* cap — minnows trade
  freely, whales are throttled on the way out. A progressive, in-swap "you can build a big bag,
  but you can't dump it fast."
- **Catch:** whales split across wallets (pair with max-per-wallet); reads per-holder state →
  client-route.
- **Meteora:** ◑ client; both primitives proven (Batches 44, 54).

### 56. No-OTC / DEX-only token (anti-backroom)
- **Uses:** CPI stack-depth gate (`depth` dexonly, Batch 46).
- **How:** the hook blocks plain wallet-to-wallet transfers (depth 2) and allows only DEX-routed
  ones (depth 3+). The token can't move off-book — no OTC deals, no quiet insider transfers;
  everything hits the public market.
- **Catch:** it also blocks legitimate wallet moves (cold storage, gifts) — a hard stance, sell it
  as transparency.
- **Meteora:** ✅ mint-keyed, proven live (Batch 46).

### 57. Soulbound badge / non-tradeable credential (P2P-only)
- **Uses:** CPI stack-depth gate (`depth` p2ponly, Batch 46).
- **How:** the inverse — block anything routed through a DEX, so the token can't be bought or sold
  on an AMM; it only moves directly between wallets. Membership badges, credentials, non-financial
  points that can be gifted but not dumped.
- **Catch:** deliberately illiquid (the point); depth is the signal, so a novel router could evade
  it — fine for badges, not for value-bearing locks.
- **Meteora:** ✅ mint-keyed, proven live (Batch 46).

### 58. Tithe token (trade only if you also give)
- **Uses:** Instructions-sysvar whole-tx read (`gatekeep` pattern, #143).
- **How:** every trade transaction must also include a SOL transfer to a charity/treasury address,
  or the hook rejects it — a tithe welded to every swap. Trading the token funds a cause by
  construction, not by promise.
- **Catch:** the buyer's client must add the donation ix (Lattice-route / custom); a bare
  aggregator swap won't include it.
- **Meteora:** ⚠️ needs the donation ix in the tx (same shape as royalty); pattern proven (Batch
  52).

### 59. Dues-paying membership token (hold-to-receive + royalty)
- **Uses:** holder-gated (`ghook`, Batch 19) + royalty (`gatekeep`, #144) — composite.
- **How:** to receive, a wallet must already hold your gate token/NFT **and** pay a membership fee
  in the same transaction. A gated, dues-paying community token — entry needs both membership and
  a fee, both enforced on-chain.
- **Catch:** two conditions, two failure modes; the gate is client-mode and the fee needs the tx
  ix. Both halves proven (Batches 19, 52).
- **Meteora:** ⚠️ / ◑ composite — client-route.

### 60. Confidential-ready token (privacy-aware rules)
- **Uses:** the confidential-transfer finding (#78/#79) — a confidential transfer fires the hook
  with `amount = u64::MAX`.
- **How:** design the hook to treat `amount == u64::MAX` as "confidential / unknown": veto rules
  and provenance still apply, amount-based rules degrade gracefully instead of overflowing or
  rejecting. A token that stays correct the day Solana re-enables confidential transfers.
- **Catch:** the ZK program is disabled on every cluster today, so this is future-proofing, not a
  live feature — the rule shape is source-derived, not yet chain-run (Batch 30).
- **Meteora:** n/a until confidential transfers ship.

### 61. Dual-yield token (interest rebase + SOL dividend)
- **Uses:** extension stack (finding 131: fee + permanent-delegate + interest-bearing + hook all
  fire) + SOL dividends (`drip`).
- **How:** stack Token-2022 interest-bearing (a UI rebase that grows the *displayed* balance) with
  a hook SOL dividend — the number in the wallet climbs and real SOL accrues per buy. Two yield
  surfaces in one token.
- **Catch:** interest is display-only (no new tokens); the hook sees the RAW amount (finding 135),
  so caps/tiers ignore the rebase — never mix interest-bearing with amount-based rules.
- **Meteora:** ◑ dividend is client-mode; the extension stack composes (Batch 51).

### 63. One-click bundle (atomic multi-hook basket)
- **Uses:** two hooked mints in one transaction (finding 129).
- **How:** a "buy the bundle" action that atomically trades several hooked tokens in a single
  transaction — each token's hook fires cleanly, no account collisions. A one-click basket/ETF
  whose components are themselves reactive hook tokens.
- **Catch:** account budgets add up across hooks (each ≤ 15 extras, Batch 48); needs a client that
  builds the multi-swap tx — aggregators won't.
- **Meteora:** ✅ multi-hook batching proven (Batch 50); the basket UX is a client build.

## K. Launchpad ideas from the shipped stack (Batches 44–58 + the Lattice product)

Everything below is built only from mechanisms that exist **today** in one of the two repos:
lazy per-wallet slots (`hlazy`/`drip`), direction-aware resolution in the Lattice swap route
(finding 151), whole-transaction gating via the Instructions sysvar (`gatekeep`/`dues`),
real-asset payout to a wallet's canonical ATA (`payout`, finding 156), buy/sell provenance
(`asym`), Merkle gating (`gatekeep` mode 2), the CPI-depth router test (`depth`), Clock-driven
state, and the registry/indexer that already renders per-token live state.

Two constraints these are all written against, because they killed earlier ideas:
- A hook can **never** move a Token-2022 asset (findings 127–130). Anything paid out must be
  **classic SPL** (or SOL). No "buying token A drips you Lattice token B" — B would be T22.
- Owner-derived accounts don't resolve on a stock aggregator, so those launches are `client`
  mode: they trade through Lattice's own route. That's a distribution cost, not a bug.

### 66. Gated launch, public graduation ("allowlist until it bonds")
- **Uses:** Merkle allowlist (`gatekeep` mode 2, #145/#151) + **migration lifts the hook**
  (Batch 26) + the normal (graduating) DBC curve.
- **How:** post the launch, collect wallets, and only allowlisted wallets can buy while the
  token is on the bonding curve. The moment it **graduates to DAMM v2 the hook comes off** and
  the token becomes permissionlessly tradeable by everyone. A genuinely fair "our people first,
  then the world" launch, with the gate enforced by Solana and the opening automatic rather
  than a promise to "turn it off later."
- **Catch:** three real ones. (1) It needs a **normal curve** — Lattice defaults to the
  *infinite* curve precisely so the hook is never stripped, so this idea inverts the house
  default and must say so loudly. (2) The root is fixed at launch, so the X-reply flow needs a
  `set_merkle_root` instruction that **doesn't exist yet** (see #67). (3) Batch 26 resolved the
  hook-lifting from known Meteora behavior, **not** a completed on-chain migration here — prove
  it on a filled devnet curve before selling it as the headline.
- **Meteora:** ◑ client while gated → ✅ fully permissionless after graduation.

### 67. Rolling waitlist (allowlist in waves)
- **Uses:** Merkle allowlist + a new `set_merkle_root` (append-only) instruction.
- **How:** the creator adds wallets in waves — wave 1 at launch, wave 2 an hour later, wave 3
  the next day — each publishing a new root. A drip-fed launch where access widens on a
  schedule you control, without redeploying or migrating anything.
- **Catch:** a mutable root is a **trust vector** — whoever holds the setter can also *remove*
  people. Make it append-only (root history stored, never shrinking) or authority-revocable,
  and show the wave history on the token page or the guarantee is worthless.
- **Meteora:** ◑ client (proof rides in the swap tx).

### 68. Referral tree ("your invite link is on-chain")
- **Uses:** lazy per-wallet slots (`drip`) + an Instructions-sysvar memo (`gatekeep` pattern)
  + SOL/token dividends.
- **How:** the Lattice buy route attaches the referrer's pubkey as a memo. On a wallet's
  **first** buy the hook writes that referrer into the buyer's slot permanently; every later
  buy splits the dividend between buyer and referrer. Referrals that can't be revoked,
  miscounted, or quietly stopped paying — the tree lives in the token.
- **Catch:** bind the referrer **once, on first buy only**, or people rewrite it to themselves;
  require the existing `min_new_slot` so self-referral farming costs real money; and a referrer
  who never buys still earns, which some communities will hate — make it a parameter.
- **Meteora:** ◑ client (needs both the memo and the owner-derived slot).

### 69. Conviction cap ("earn the right to buy bigger")
- **Uses:** per-wallet slots + buy/sell provenance (`asym`) + Clock.
- **How:** the inverse of a whale cap. Every wallet starts with a small per-trade cap; holding
  without selling raises **that wallet's own** cap step by step, and any sell resets it. New
  money is throttled, proven holders are trusted. A fair launch that opens up per person rather
  than globally.
- **Catch:** trivially sybil-able unless paired with max-per-wallet — a whale just uses ten
  wallets and never gets throttled; ship the two together or don't ship it. Also frame the
  reset honestly: it punishes legitimate partial exits too.
- **Meteora:** ◑ client.

### 70. Two-class launch (presale vests, public is liquid)
- **Uses:** per-holder vesting (`drip` mode 1, #150) + a cutoff slot.
- **How:** everyone who buys before slot X (the presale window) has their tokens vest on the
  standard cliff-and-drip schedule; everyone after buys liquid. The exact structure real
  launches use — early access in exchange for a lock — with the lock enforced per wallet by the
  chain instead of by a spreadsheet and a multisig.
- **Catch:** the two classes are only distinguishable by *first-buy slot*, so a presale buyer
  who also buys later still has their whole position governed by their first entry — document
  that, or add a second slot field. Presale sells fail on stock aggregators (a feature here).
- **Meteora:** ◑ client.

### 71. Progressive trade tax (the bigger the order, the bigger the toll)
- **Uses:** Instructions-sysvar payment check (`gatekeep` mode 1 / `dues`) + the hook's `amount`.
- **How:** instead of a flat royalty, the required in-transaction payment **scales with trade
  size** — small buys pay a token amount, whales pay real money. A progressive tax that funds
  the treasury/charity and dampens size at the same time, enforced in the transfer path.
- **Catch:** the client computes and attaches the payment, so this only works through the
  Lattice route; and a determined whale splits into many small buys — pair with a per-wallet
  tally if that matters. Amount-based rules also break under interest-bearing mints (#135).
- **Meteora:** ⚠️ needs the payment ix in the tx (proven on direct transfers, Batch 52).

### 72. Tiered membership (benefits scale with how much of the gate token you hold)
- **Uses:** holder-gate ATA read (`ghook`/`dues`) — reading the gate balance as an **amount**,
  not a boolean.
- **How:** today the gate is binary (hold ≥1 or you're rejected). Make it tiered: hold 1k of
  the membership token for a small cap, 10k for a bigger one, 100k for no cap at all. One token,
  a real membership ladder, and the tiers are checked inside every trade.
- **Catch:** it makes the gate token's price the real gatekeeper — thin gate-token liquidity
  means tiers whipsaw; and it's still one ATA read, so tiers must be simple thresholds, not a
  curve.
- **Meteora:** ◑ client (owner-derived gate ATA).

### 73. Milestone treasury (volume unlocks a payout)
- **Uses:** the volume accumulator (`evolve`/`ahook`) + real-asset payout (`payout`, #156).
- **How:** the creator funds a USDC treasury and sets milestones — at 100 SOL of volume, 250,
  500 — each crossing releases a tranche to a cause, to holders, or to a public-goods address.
  "We'll donate as we grow" turned into something the chain does on its own.
- **Catch:** volume is wash-tradeable, so milestones measured in volume are gameable — prefer
  *distinct holders* or accept it and set the tranches small. Release is claimed off the swap
  path (a separate instruction), which is fine but means someone has to poke it.
- **Meteora:** ✅ accrual is mint-keyed; ◑/off-path for the claim.

### 74. Abandonment refund (an honest dead-man's switch)
- **Uses:** last-trade timestamp (`ahook`/Clock) + treasury payout + the pro-rata claim pattern
  (`stakepool`).
- **How:** the creator locks a treasury at launch. If the token goes **untraded for N days**,
  that treasury unlocks and becomes claimable pro-rata by whoever still holds. A rug-resistance
  primitive: if the team walks away, the money comes back to holders automatically, and nobody
  has to be trusted to trigger it.
- **Catch:** "abandoned" is only ever a proxy — a single wash trade a week keeps it alive
  forever, so pick N with that in mind and disclose it. The pro-rata claim needs a stake/
  snapshot step (reuse `stakepool`), which means holders must act to claim.
- **Meteora:** ✅ the liveness stamp is mint-keyed; the claim is off-path.

### 75. The receipt (a token whose holder history is the product)
- **Uses:** per-wallet slots (`hold`/`drip`: `received`, `sent`, `first_slot`) + the existing
  Lattice indexer, decoders and `/api/v1`.
- **How:** ships almost entirely on what's already built. Every wallet's slot is a permanent,
  un-fakeable record of what it bought and when it first arrived — so the token page can show a
  real **OG board**: earliest holders, longest unbroken holds, biggest conviction. Not a
  snapshot someone took, not a Dune query that can be redefined — the chain's own record,
  rendered. The pitch is social, and the mechanism is free.
- **Catch:** it's a *display* of state, not an enforcement — it changes nothing about how the
  token trades, so it only matters if the community cares about the flex. Slots are per wallet,
  so moving between your own wallets resets your standing.
- **Meteora:** ◑ client (per-wallet slots); the board itself is off-chain rendering.
