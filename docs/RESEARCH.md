# Research log

Hooked started as a lab: a systematic map of what Solana Token-2022 transfer hooks can and can't do.
Every capability was built as a small Anchor program and run against devnet, including live Meteora
Dynamic Bonding Curve swaps, before anything was shipped. This is the log of those experiments,
batch by batch, in the order they were run. Later batches record the mainnet deployments.

This copy is a selection: batches that are purely about hardening and internal review are left out.

## Batch 4 — Transfer provenance / buy-vs-sell detection (`phook`)

A hook can deserialize the **source** token account (index 0) and read its owner,
not just the destination. Comparing source/dest owner to a configured **pool
authority** classifies each transfer as a buy, a sell, or a wallet transfer — the
core primitive a market-reactive token needs on an AMM.

| # | Capability | Test | Result |
|---|---|---|---|
| 15 | **Read source owner** — deserialize the source account inside Execute | source as `InterfaceAccount<TokenAccount>` | ✅ owner readable |
| 16 | **Buy/sell/wallet classification** — pool sends = buy, pool receives = sell, else wallet | 2 buys, 1 sell, 3 wallet | ✅ buys=2 sells=1 wallet=3 |

**What this establishes**
- The hook sees **both ends** of a transfer. `source.owner == pool` ⇒ tokens are
  leaving the pool ⇒ **buy**; `dest.owner == pool` ⇒ entering the pool ⇒ **sell**;
  neither ⇒ a plain wallet-to-wallet move.
- This is enough to drive **asymmetric behavior** (e.g. different rules or accounting
  for buys vs sells) purely on-chain — the thing a "market-reactive" hook wants.
  Prior research found no verified deployed example of this on Meteora; here it's a
  working, tested pattern (against a stand-in pool authority).

**Caveats / next step**
- Tested against a **stand-in** pool-authority keypair, not a live Meteora pool.
  The mechanism (owner comparison) is venue-agnostic, but confirming it end-to-end
  through an actual Meteora DBC/DAMM swap on devnet is the outstanding integration
  test. Real Meteora pools use *program-derived* vault authorities, so a production
  version hardcodes those (as our earlier CappedPad/max-holding hook did).

---

## Batch 5 — Resolver mechanics & limits (`rhook`)

The extra-account resolver is more than static PDAs.

| # | Capability | Test | Result |
|---|---|---|---|
| 17 | **Amount-dependent account** — resolve a PDA from the transfer amount via `Seed::InstructionData{offset 8, len 8}` | 2 different amounts | ✅ resolved address tracked the amount (hook re-derived and matched) |
| 18 | **Multi-account resolution ceiling** — how many extra accounts fit in a transfer | ramp 5→30 | ⚠️ **10 OK, 15 failed** (tx account/size limit) |

**What this establishes**
- **Amount-dependent routing works.** The Execute instruction data is
  `[8-byte disc][8-byte amount LE]`, and an `InstructionData` seed at offset 8 lets
  the resolved account **change with the transfer amount** — e.g. route to a
  per-tier or per-bucket account chosen by size. Confirmed by having the hook
  re-derive `PDA["amt", amount]` and match the resolver's account.
- **There's a hard practical ceiling on extra accounts.** On a *bare* transfer,
  ~10 extra accounts resolve but 15 fails — the ~64-account / 1232-byte transaction
  limit. Inside a real DEX swap (which brings its own accounts) the usable budget is
  **lower**. Every extra account a hook needs is a direct tax on composability and
  listability — keep the count small.

**Takeaway for design**
- Dynamic resolution (`AccountData` off another account, `InstructionData` off the
  amount) is real and useful, but the account-count budget is tight. Favor one or
  two extra accounts; don't design a hook that needs a dozen.

---

## Batch 8 — Meteora veto + live reconfig (`vhook` on DBC)

Batch 7 showed a hook *observing* a Meteora swap. This shows a hook *controlling*
one: a rejecting hook aborts the buy, and flipping its config re-enables it — all
on a live devnet DBC pool.

| # | Capability | Test | Result |
|---|---|---|---|
| 24 | **Hook veto enforces on a Meteora swap** | `vhook` MaxAmount(1), buy 0.02 SOL | ✅ buy REJECTED (`TooLarge`) — the DEX swap fails |
| 25 | **Live reconfig affects Meteora swaps** | flip cfg → allow-all, buy again | ✅ same buy SUCCEEDS after the config change |

Proof pool `H15fuEFoDazCTFS4Vi3bh38JDi82ubVKENE5wn55DHdR`; allow-swap tx
`5jZXGGFg4HaTnPJVPta693uJSXzJ75qJWnffbcCjkgJsaaMotKbDK3qCBXJFsnYxsEV3gws5c8Zx9UbsJ5KwNhqb`.
Script: `scripts/meteora-vhook-veto.mts`.

**What this establishes**
- Every read-and-reject capability from Batch 1 (anti-whale, blacklist, allowlist,
  time-lock, pause, min/max amount) **actually blocks trades on Meteora** — not just
  on raw transfers. A vetoing hook fails the whole swap transaction.
- Because the config PDA is authority-updatable, a launch can **change the rules
  live** and the very next Meteora swap obeys them (e.g. flip a pause, tighten a cap).
  Whether that authority is retained or revoked is the credibility knob.

**Net "on Meteora" conclusion**
- A hooked Token-2022 launched on Meteora DBC (devnet) both **fires the hook on
  every swap** (observe / accumulate / CPI) and **can veto swaps** (enforce rules).
  The full capability catalog in this repo therefore applies to a real Meteora
  launch, not just isolated transfers.

---

## Batch 9 — Meteora SELL fires the hook (`ahook` on DBC)

Completes the Meteora picture: Batch 7 proved buys, this proves sells.

| # | Capability | Test | Result |
|---|---|---|---|
| 26 | **Hook fires on a Meteora SELL** (base→quote) | sell 100 base units on the Batch-7 pool | ✅ `ahook` count 1→2 |

Sell tx `8knnxZJgA7adiAEwnph5id1QnverxeFpSPYcsThgayJhtNpUzrs9TUzs9SYZewdCdptvFWrF8fVetaki6G65fRt`.
Script: `scripts/meteora-ahook-sell.mts`. So a hook runs on **both sides** of every
Meteora trade — buys and sells alike.

---

## Batch 11 — Composing Token-2022 extensions (transfer fee + hook)

A hook doesn't have to be the mint's only extension.

| # | Capability | Test | Result |
|---|---|---|---|
| 29 | **Transfer fee + transfer hook on one mint** | mint with both extensions, one transfer | ✅ both active: 1% withheld AND hook fired (count=1) |
| 30 | **Hook runs after fee withholding** | send 1.0, read recipient + hook | ✅ recipient got net 0.99; hook saw the transfer (post-fee balance) |

**What this establishes**
- The built-in **TransferFee** extension and a custom **TransferHook** **compose** on
  the same mint — you get a protocol-level fee *and* custom logic together. Test:
  `tests/combo.ts` (no new program; reuses `ahook`).
- The hook executes **after** the fee is withheld, so `destination.amount` is the
  **net** amount — matches the ordering we relied on for the max-holding cap.
- Practical combo: a small built-in fee (real, enforced, collectable) + a hook for
  the behavioral logic, rather than trying to make the hook itself take a cut of the
  hooked token (which it can't).

---

_Housekeeping: to reclaim devnet rent, several standalone probe programs were
closed after their findings were recorded — `chook`/`phook`/`rhook`/`lhook`/`ohook`
(~8.6 SOL) and later `zhook`/`xhook`/`dhook`/`climit`/`ihook`/`growhook` (~10.2 SOL).
All findings above remain valid — the proof txs are immutable and every program's
keypair is saved (but note: a CLOSED program id is permanently retired — redeploy needs a NEW id, as we hit with chook). `vhook`, `ahook`, `mhook`,
`ghook` stay live._

---

## Batch 12 — Capstone: composed market-reactive hook on live Meteora (`mhook`)

Several proven capabilities in ONE hook — the shape a real launch would ship — run
against a live DBC pool. `mhook` classifies buy/sell/wallet by provenance, tallies
per-side volume, and caps buys-per-slot (self-scoped so sells/wallet moves aren't
throttled). One writable extra account.

| # | Capability | Test | Result |
|---|---|---|---|
| 31 | **Multiple capabilities compose in one hook** | provenance + volume + per-slot buy cap together | ✅ all active in a single Execute |
| 32 | **Real Meteora buy vs sell classified on-chain** | buy 0.02 SOL, sell 50 units | ✅ buys=1, sells=1, wallet=0 |
| 33 | **Confirmed DBC pool authority** for provenance | source.owner on a buy | ✅ `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` — a DBC buy's source owner |
| 34 | **Accurate per-side volume** | buyVolume vs sellVolume | ✅ buyVol 664.6, sellVol 50.0 |

Proof pool `EseQ1rX9GuKn6DPNAXkjB9oKhhTP7tTUdTWGQZwoJJ6B` (devnet). Script:
`scripts/meteora-mhook.mts`.

**What this establishes**
- The capability catalog isn't just isolated demos — they **combine** into a single,
  realistic, launchable hook that does live on-chain market accounting on Meteora.
- **Confirmed empirically**: the DBC pool authority `FhVo3mqL…` is what a buy's
  source account is owned by, so pool-authority buy/sell discrimination on Meteora
  **works** (earlier research found no verified deployed example — here it is, tested).
- Self-scoping the rate limit to **buys** avoids throttling ordinary sells/wallet
  moves — a cleaner anti-bundler than a global per-slot cap.

---

## Batch 15 — Arbitrary CPI to a non-token program (`zhook` mode 2)

| # | Question | Result |
|---|---|---|
| 43 | can a hook CPI a **non-token** program (SPL Memo) during Execute? | ✅ **POSSIBLE** — the Memo program ran inside the transfer |

**What this establishes**
- A hook's CPI reach is **not limited to the token program**. It can invoke *any*
  program mid-transfer (logging, cross-program triggers, calling your own program to
  run bespoke logic). Combined with Batch 3 (mint/burn) this means "on every trade,
  do X in program Y" is generally implementable — as long as X only touches accounts
  the hook is allowed to (its own/side accounts), never the sender's or the hooked
  token.
- Caveat: each such CPI adds accounts + compute to every transfer, and any program
  you call must itself tolerate being invoked from a transfer-hook context (no
  reliance on the instruction sysvar's top-level caller, etc.).

---

## Batch 17 — Compute-unit budget inside a hook (`climit`)

How much work can a hook actually do? The hook runs `amount` keccak iterations;
ramping the amount and reading consumed CU maps the ceiling.

| # | Measurement | Result |
|---|---|---|
| 45 | hook work at the **default** compute budget | ~**1,200 keccak iters** before the ~200k-CU/tx cap (tx used ~190k CU total, shared with the transfer) |
| 46 | hook work with a **raised** budget (`ComputeBudget` 1.4M) | ~**9,000 keccak iters** (~1.18M CU; ~131 CU/keccak) |

**What this establishes**
- A hook's compute is the **transaction's** budget minus what the transfer + account
  resolution already spent — roughly **~150–190k CU at default**, expandable toward
  the **~1.4M** per-tx ceiling.
- **But raising it is the CALLER's job.** The `ComputeBudget` instruction lives in the
  outer transaction, which the wallet / DEX / aggregator builds — not the token. So a
  hook that needs more than the default budget will **fail on any client that doesn't
  bump the limit**. On a heavy DEX swap the hook gets even less headroom.
- **Design rule:** keep the hook comfortably under ~150k CU. That's plenty for
  read-and-reject, a few state writes, one or two CPIs — but not for heavy crypto,
  big loops, or many CPIs. Measure the real cost on the target venue.

Test: `tests/climit.ts`.

---

## Batch 19 — Holder-gated transfers (`ghook`)

Can the hook require the RECIPIENT to already hold a *different* token to receive?

| # | Question | Result |
|---|---|---|
| 48 | gate transfers on the recipient's holdings of another token/NFT | ✅ gate-holder → **PASS**, non-holder → **REJECT** (reads the recipient's gate-token ATA via an external-PDA resolution off `dest.owner`) |
| 49 | (gotcha) does the AccountData-off-`dest.owner` resolution need the destination to exist first? | ⚠️ **Yes** — the client-side resolver reads `dest.owner` from chain *before* sending; if the destination ATA is created in the same tx it can't be read. Create/ensure the destination first. |

**What this establishes**
- **"Must hold X to receive" is implementable.** The hook resolves the recipient's
  associated account for a gate mint (membership token, NFT, another coin) and rejects
  if it's missing/empty. Enables **community-gated / allowlist-by-holding / soulbound-
  to-a-group** tokens without a maintained address list.
- The gate check reads a **classic-SPL** account balance (offset 64) — for an NFT,
  "balance ≥ 1 of the collection token".
- **Integration nuance:** any hook that derives an extra account from `dest.owner`
  (via `AccountData`) requires the destination account to exist at resolution time.
  Most swaps create/reuse the recipient ATA up front, but a naive same-tx create
  breaks resolution. (Same lesson applies to reward-drip designs.)

Test: `tests/ghook.ts`.

---

## Batch 21 — Gross vs net amount on a fee mint (`tests/feeamount.ts`)

| # | Question | Result |
|---|---|---|
| 52 | on a transfer-fee mint, is the hook's `amount` arg gross or net? | ✅ **GROSS** — sent 1,000,000 with a 1% fee, hook recorded `amount` = **1,000,000** (the requested/pre-fee amount), while `destination.amount` = 990,000 (net, post-fee, from Batch 11). |

**What this establishes**
- The two amount signals differ on a fee mint and mean different things:
  - **`amount` arg = GROSS** (what the sender requested, pre-fee).
  - **`destination.amount` = NET** (what actually landed, post-fee — Execute runs
    after fee withholding).
- **Pick deliberately:** a volume/turnover counter that wants gross uses `amount`; a
  max-holding cap wants `destination.amount` (net, the real balance). Using the wrong
  one silently over/under-counts on fee tokens.

---

## Batch 22 — Transaction / instruction introspection (`ihook`)

Can a hook see the OTHER instructions in the transaction it's part of?

| # | Question | Result |
|---|---|---|
| 53 | can a hook read the **Instructions sysvar** and enforce a tx-level rule? | ✅ **Yes** — `ihook` required a sibling **Memo** in the same tx: with-memo → PASS, no-memo → REJECT. A hook can walk the transaction's top-level instructions. |

**What this establishes**
- A hook can enforce **transaction-level composition**: "every transfer must be
  accompanied by instruction X", detect certain instruction patterns, or read data
  from a sibling instruction. Genuinely powerful for closed/direct-transfer systems.
- **Big caveat (same class as caller-checks):** the Instructions sysvar shows the
  **top-level** instructions. Under a DEX/aggregator swap the top level is the
  **router**, not the token transfer — so a "require a memo" rule would **reject
  every swap** (routers don't add your memo). This capability **breaks open
  tradability** unless the venue happens to include the required instruction.
- **Verdict:** use for wallet-to-wallet / app-controlled flows where you build the
  tx; do **not** put an instruction-presence requirement on a token you want traded
  on Meteora/Jupiter. (It's the flip side of Batch 6/Neodyme's caller-check warning.)

Test: `tests/ihook.ts`.

---

## Batch 23 — Self-realloc in a hook (RESOLVED: it works)

Isolated the earlier inconclusive `growhook` panic with `rehook`, which reallocs
the **same** state account two ways — as a top-level instruction (`grow_direct`)
and from inside the Execute CPI (`transfer_hook`) — using identical, panic-free
realloc code.

| # | Question | Result |
|---|---|---|
| 54 | can a hook **grow its own account (`realloc`)** during a transfer? | ✅ **YES.** DIRECT realloc: 8 → 108 B; **HOOK realloc (inside Execute): 108 → 208 B.** Both succeeded. The CPI/hook context has the growth headroom. |

**What this establishes (and a correction)**
- **A hook CAN grow its own storage mid-transfer.** So **unbounded on-chain
  registries / append-only logs from a hook are possible** — bounded only by the
  pre-funded lamport buffer (the account must stay rent-exempt at the new size) and
  Solana's 10 MB account cap and 10 KB/instruction realloc step.
- **Correction:** the earlier `growhook` result (logged as inconclusive/negative)
  was a **bug in growhook's own counter-write code**, not a hard limit. `rehook`
  isolates realloc alone and it works in both contexts. So the "hook storage is
  fixed-capacity" assumption from earlier batches is **wrong** — you can grow it,
  you just need the account over-funded for future rent (no payer is available at
  transfer time, so pre-fund the buffer at init).

Program `rehook` (`8kpzGh13DTrCFxyuyLE8kckh4cYa7u5RoepP6BxFCwQv`), `tests/rehook.ts`.
(`growhook` retired.)

---

## Batch 25 — Chained AccountData resolution (`chainhook`)

Can a later extra account be resolved from data stored in an EARLIER resolved
extra account (pointer indirection / multi-hop)?

| # | Question | Result |
|---|---|---|
| 57 | resolve extra #2 (`node`) using an 8-byte seed read via `AccountData` from extra #1 (`ptr`)? | ✅ **Yes.** The on-chain hook required `node == derive(["node", ptr.seed])` and the transfer **passed**, proving the resolver chained: it read the pointer account's data and derived the node PDA from it. |

**What this establishes**
- **Multi-hop / pointer-based resolution works.** An `AccountData` seed can reference
  an account that was itself resolved earlier in the same meta list (`account_index`
  pointing at a prior extra). So you can have a **pointer account that redirects to a
  target account** — upgradable routing ("read the config to find the current target"),
  registries with indirection, per-mint dispatch tables.
- Confirmed on-chain (the hook re-derives from the pointer's live data and matches);
  the proof is that the transfer only succeeds when the chain resolved correctly.
  (A client-side re-derivation in the test differed on a serialization detail — the
  on-chain check is authoritative.)
- Still bounded by the ~10-extra-account ceiling (Batch 5) and the fact that each
  hop's account must exist for `AccountData` to read it.

Test: `tests/chainhook.ts`.

---

## Batch 27 — Taxing a hook token & routing the tax to a treasury (`tests/tax.ts`)

| # | Question | Result |
|---|---|---|
| 58 | can you levy a **% tax** on a hook token and **route it to a treasury**? | ✅ **Yes** — via the Token-2022 **Transfer Fee extension** (which composes with the hook). 1.0 traded → **0.05 (5%) withheld and withdrawn to the treasury**, buyer keeps 0.9, and the **hook fired on the same transfer** (count=1). |

**The precise answer (important nuance)**
- **The hook itself does NOT do the taxing** — it can't touch the traded token
  (read-only source/dest; Batch 3/16). A hook alone cannot skim a % of the coin.
- **The tax is the Transfer Fee extension**, a separate Token-2022 feature that
  withholds a configurable % on every transfer, collected by the withdraw-withheld
  authority. It **composes with the hook** (both active on one mint; Batch 11 + here).
- So "tax a hook token → treasury" is done by **fee extension (the tax) + hook (custom
  logic), side by side** — verified end to end: transfer → 5% withheld → `withdrawWithheldTokensFromAccounts` → treasury.
- What the **hook** can add around the tax: record/accrue tax owed (Batch 2), charge an
  *extra* fee in a **side token** via CPI (only if the payer pre-approved a delegate →
  works on your own frontend, breaks through open DEXes; Batch 3), or gate/react. It
  cannot itself take a cut of the traded token.

---

## Batch 28 — Which Token-2022 extensions compose with a transfer hook (`tests/extensions.ts`)

Tried creating a mint with the hook + each extension, then confirmed a transfer
still fires the hook.

| # | Extension + hook | Result |
|---|---|---|
| 59 | **MetadataPointer** (on-chain name/symbol/image) | ✅ composes; hook fires |
| 60 | **TransferFeeConfig** (the % tax) | ✅ composes; hook fires |
| 61 | **PermanentDelegate** (an authority can move/burn anyone's tokens) | ✅ composes; hook fires |
| 62 | **MintCloseAuthority** | ✅ composes; hook fires |
| 63 | **InterestBearingConfig** (display interest) | ✅ composes; hook fires |
| 64 | **NonTransferable** | ⚠️ mint can carry both, but transfers are blocked by design → hook never fires (pointless combo) |
| — | **DefaultAccountState(Frozen)** | ❓ init failed **in my test** — but because I passed no freeze authority (DefaultAccountState requires one), not a proven hook conflict. Re-test with a freeze authority to confirm (expected to compose → forced-allowlist pattern). |

**What this establishes**
- A transfer hook is **stackable** with most Token-2022 extensions. Practical combos:
  - **MetadataPointer + Metadata** → on-chain name/symbol/image (essentially required).
  - **TransferFee + hook** → a protocol tax *plus* custom logic (Batch 27).
  - **PermanentDelegate + hook** → moderation/clawback ability + hook rules (powerful,
    but a big trust flag — the delegate can seize anyone's tokens).
  - **InterestBearing / MintCloseAuthority** → cosmetic/admin niceties, compose fine.
- **NonTransferable** is the one that's logically exclusive: it makes the token
  untransferable, so the hook has nothing to run on.
- **Confidential Transfer** was not tested here, but is known to conflict with transfer
  hooks (the hook can't run over an encrypted transfer) — treat as incompatible.
- Every composing extension still **fired the hook on transfer** — so stacking them
  doesn't disable the hook.

---

## Batch 29 — Re-testing "known" claims (`tests/extensions2.ts`)

"Known ≠ proven." Two items from Batch 28 were assumed, not tested. Tested them.

| # | Claim (Batch 28) | Actual result |
|---|---|---|
| 65 | DefaultAccountState(Frozen) — *"inconclusive"* | ✅ **COMPOSES** — with a freeze authority set, the mint builds; accounts are frozen by default, thaw to approve, then transfers **fire the hook** (count=1). A real **forced-allowlist / KYC** pattern. My earlier failure was a missing freeze authority, not a hook conflict. |
| 66 | Confidential Transfer — *"known incompatible"* | ⚠️ **CORRECTED** — a mint with **both** `ConfidentialTransferMint` and `TransferHook` **initializes fine** (they coexist at the mint level). So the blanket "incompatible" was wrong. |

**Precise status on Confidential Transfer**
- **Proven:** the two extensions can be present on the same mint (init succeeds).
- **NOT tested (be honest):** whether an actual *confidential (encrypted)* transfer
  runs the hook, or whether the confidential transfer path conflicts at transfer
  time. The theoretical concern (a hook can't read encrypted amounts) is
  unverified here — testing it needs the full ElGamal/confidential-transfer flow.
  So: *coexist at init = yes; behavior of a real confidential transfer with a hook =
  still open.* Do not state it as incompatible without that test.

**Lesson (repo principle):** re-test inherited "facts." Batch 28's two soft claims
both moved when actually run — one from inconclusive→works, one from
incompatible→coexists.

---

## Batch 31 — Meteora DBC compatibility matrix (which hook types actually work on a swap)

Not everything that works on a raw transfer works through Meteora's
`swap2WithTransferHook` tooling. Verified each hook TYPE against a live DBC pool.

| Hook type | Program | On Meteora DBC swap |
|---|---|---|
| Read-and-reject validator | `vhook` | ✅ veto works (Batch 8) |
| State accumulator (count/volume/holders) | `ahook`, `mhook` | ✅ fires on buy + sell (Batches 7, 9) |
| Provenance (buy/sell/wallet) | `mhook` | ✅ (Batch 12) |
| Composed (provenance + volume + per-slot cap) | `mhook` | ✅ (Batch 12) |
| **CPI side-token mint/burn (5 extras + CPI)** | `chook` | ✅ **NEW — vault minted a side token during the buy; 5 simple-seed extras + a CPI fit the swap** |
| **Dynamic external-PDA + `AccountData` resolution** | `ghook` | ⛔ **NEW — FAILS at build: `TokenTransferHookInvalidSeed`** (the swap resolver can't derive the recipient's other-token ATA) |

**The rule (important)**
- **Works on Meteora:** hooks whose extra accounts use **static / simple seeds** —
  `Literal`, `AccountKey{index}`, fixed pubkeys — even **many** of them, and even with
  a **CPI** inside the hook. (vhook / ahook / mhook / chook.)
- **Does NOT work on Meteora (standard swap tooling):** hooks that **resolve an account
  from another account's DATA at transfer time** — an `AccountData` seed feeding an
  external-PDA derivation (e.g. "the recipient's ATA of gate-token X"). Meteora's
  `swap2WithTransferHook` throws `TokenTransferHookInvalidSeed`, even though the exact
  same hook resolves fine on a raw `createTransferCheckedWithTransferHookInstruction`
  (Batch 19). The gap is in the swap-time resolver, not the on-chain program.

**Critical launch implication**
- **Holder-gating (LAUNCH-IDEAS #24) is NOT Meteora-DBC-tradeable** via the standard
  swap path — it relies on exactly this dynamic external-ATA resolution.
- **The `manna` reward-drip uses the same external-ATA resolution** (deriving the
  recipient's reward ATA). So the hands-off drip that fires on a raw transfer would
  **hit the same `TokenTransferHookInvalidSeed` wall on a Meteora buy** — this is a
  material caveat on the reward-drip ideas (#9, #10) that earlier assumed it "fires on
  buys." **Reframe: reward drips work on your own frontend / raw transfers, not through
  Meteora's swap resolver** (unless the resolver adds AccountData/external-PDA support).
- **Safe on Meteora:** validators, accumulators, provenance, CPI-to-side-token — the
  building blocks of most launch ideas — as long as their extra accounts use simple seeds.

Scripts: `scripts/meteora-chook.mts` (✅), `scripts/meteora-ghook.mts` (⛔).

---

## Batch 33 — 5 NEW hook mechanics, each verified on devnet + Meteora (`evolve`, `emit`)

Genuinely new behaviors (not just "read X") — self-modifying rules and reactive
emission — all using mint-keyed simple seeds so they work through Meteora's swap.

| # | New mechanic | Devnet | Meteora DBC |
|---|---|---|---|
| 70 | **Self-loosening cap** — max-holding % DOUBLES each time cumulative volume crosses a threshold ("chapters") | ✅ 1.5% holding rejected at tier0 (1%), passes after volume→tier1 (2%) | ✅ buy fired the hook + advanced the on-chain volume counter that drives the cap |
| 71 | **Self-tightening cap** — cap SHRINKS by 1 bp / `param` seconds toward a floor (Clock-driven) | ✅ 1.5% passes at t=0 (1.7%), rejected after ~35s (~1.35%) | ⤷ same program/resolution as #70 (Clock read is in-handler) |
| 72 | **Halving emission** — mint `base >> epoch` of a side token to a global vault (decaying "mining") | ✅ epoch0 +1.0, later epoch +0.25 (halved) | ✅ buy minted the side token to the vault (6 extras + CPI fit the swap) |
| 73 | **Reactive burn** — on a SELL (dest owner == pool authority) burn `amount*bps/1e4` of the side token in-hook ("dump-catcher") | ✅ buy → no burn; sell 1.0 → burned 1% of the trade | ⤷ same emit program/resolution; sell-detection uses the DBC pool authority (proven Batch 12) |
| 74 | **RNG bonus emission** — SlotHashes RNG: ~10% of trades mint 10x, else 1x ("jackpot accrual") | ✅ 8 trades minted `[10,10,1,10,1,1,1,1]` (random 10x hits) | ⤷ same emit program/resolution; SlotHashes read proven on Meteora path (Batch 13) |

**Directly Meteora-verified:** #70 (evolve mode 0 — cap enforces + volume counter
advances on a live buy) and #72 (emit mode 0 — halving mints on a live buy, and a
**6-extra-account CPI hook fits the Meteora swap budget**). #71/#73/#74 share the
exact same program + account resolution (verified on Meteora) and use only in-handler
primitives already proven on Meteora (Clock, provenance/source-owner, SlotHashes, CPI),
plus full devnet verification.

**What this adds to the map**
- **Self-modifying rules** — a hook that rewrites its OWN enforcement based on
  on-chain state (volume) or time, with no external trigger. New class of behavior.
- **Reactive emission** — the *act of trading* drives a side-token economy on-chain:
  a decaying emission schedule (halving), a sell-reactive burn (in-hook dump-catcher,
  no crank), and randomness-gated variable rewards (on-chain jackpot accrual).
- All fully on-chain, hook-only, Meteora-tradeable (mint-keyed seeds), and the reward
  side accrues to a **global vault** — compatible with the on-chain-only / no-frontend
  constraint (distribute via on-chain claim or buyback-burn).

---

## Batch 36 — Reactive pairs & the token-as-oracle (`pulse`, `harvest`)

Two deeper moves in the outward-looking-hook frontier opened by Batch 35, each verified
on devnet **and** live on Meteora.

### Reactive pair — a *continuous* coupling, not a binary gate (`pulse`)

Batch 35's `twin` flipped A on/off from B. `pulse` makes A's rule a **continuous function**
of B's live buy/sell pressure: A's per-trade cap = `base + step · (partner_buy − partner_sell)/unit`.
Sibling accumulated → A loosens; sibling dumped → A tightens. Provenance is by destination
(dest owner == pool authority ⇒ sell, else buy), which is exactly how a Meteora buy/sell reads.

| # | Question | Result |
|---|---|---|
| 83 | can A's cap track sibling B's net pressure **continuously & bidirectionally**? | ✅ **Yes** (devnet) — a 15.0 transfer of A was **VETOED** at B-net 0 (cap 10.0), **PASSED** after B was bought +6.0 (cap 30.0), then **VETOED again** after B was dumped back to net 0 (cap 10.0). The cap slides both ways. |
| 84 | does the reactive cap enforce on a **live Meteora swap**? | ✅ **Yes — chain-verified.** A in a real DBC pool; a reference buy measured the swap size Q≈1.66, the cap was tuned to straddle it, then the **same Meteora buy was VETOED** (`OverReactiveCap`, err 6003) while B was flat and **SUCCEEDED** after B was bought +6.0. Pool `DV4kVxF2XWouseyGwH4QjdfPzsg6kBdEUJzTJGFYLQbu`. |

### Token-as-oracle — a coin's live pressure, consumed by a *separate* program (`harvest`)

Finding #81 showed one hook reading another's state. `harvest` is the real thing: a
**different program id** that reads a `pulse` coin's `buy_vol` feed (fixed raw offset) and
mints a yield token proportional to it — the coin *is* the oracle; an unrelated vault pays
yield off its trading.

| # | Question | Result |
|---|---|---|
| 85 | can a **separate program** consume a coin's live feed and act on it (on-chain)? | ✅ **Yes** (devnet) — `harvest` minted **10.0** yield after the coin was bought 10.0, then **+5.0** after another 5.0 (delta-checkpointed, no double-count); a harvest with no new buys was rejected. Two distinct program ids, one feeding the other. |
| 86 | is the feed driven by **real Meteora trades**? | ✅ **Yes — chain-verified.** A live Meteora buy of coin C raised its `buy_vol` to **1.66** (the hook fired *inside* the swap), and `harvest` then minted **exactly 1.66** yield from it. Pool `FSqJknxQodfcTQqTUxke6NNm1kLqJyMnjutGG4DsXf76`. |

**What Batch 36 adds to the map**
- **Reactive coupling is continuous, not just gated** — a token can have a live, sliding
  rule (cap, and by extension fee/whale-limit) driven by *another* token's market, enforced
  inside Meteora's swap. Paired/hedged/lead-lag token designs are real and tradeable.
- **A hook's published state is a first-class on-chain oracle** — consumed not only by
  sibling hooks but by *arbitrary* programs (a yield vault here), fed by live DEX trades.
  "The memecoin is the price feed" is a buildable primitive, not a metaphor.
- Both keep the frontier's Meteora-safety property: coupling via **mint-keyed + fixed-pubkey**
  extras only (the `pulse` reactive read is a fixed-pubkey sibling-state extra; `harvest`
  is off the swap path entirely).

Programs: `programs/pulse`, `programs/harvest`. Tests: `tests/pulse.ts`, `tests/harvest.ts`
(green on devnet). Live Meteora: `scripts/meteora-pulse.mts`, `scripts/meteora-harvest.mts`.

---

## Batch 37 — Multi-sibling baskets & mutual feedback loops (`basket`, `pulse`)

Two further moves in the outward-looking-hook frontier — a token indexed to a *basket* of
others, and two tokens coupled to *each other* — each verified on devnet **and** live on Meteora.

### Multi-sibling — a token indexed to a basket (`basket`)

`pulse` reacted to one sibling; `basket` reacts to the **aggregate** of N. It reads a basket
of sibling feeds (fixed-pubkey extras via `remaining_accounts`) and sets its cap from the
**sum** of their net buy pressure — so it takes the *whole basket*, not any single member, to move it.

| # | Question | Result |
|---|---|---|
| 87 | can a hook aggregate **N sibling feeds** and react to the basket sum? | ✅ **Yes** (devnet) — A indexed to {B,C,D}: a 15.0 transfer was **VETOED** with one sibling bought (+3 → cap 12) and **PASSED** only once the full basket was bought (+9 → cap 16). It's the sum, not any single member. |
| 88 | do **N sibling extras** resolve on a live Meteora swap? | ✅ **Yes — chain-verified.** A (basket over {B,C,D}) in a DBC pool: a real Meteora buy was **vetoed while flat**, **still vetoed with one sibling bought**, and **succeeded** only after the whole basket crossed. 4 extra accounts (state + 3 sibling feeds) resolved inside the swap. Pool `DrSuofL2CQStfR1HFn5uV5P7YPenR7UxMuicJkR74AEN`. |

### Feedback loop — two tokens coupled to each other (`pulse` ×2)

Point two reactive tokens at each other (A.partner=B, B.partner=A). Hooks only **read** each
other's state — no CPI — so there is **no recursion**: each transfer reads a snapshot of the
counterpart's current state. The open questions were whether it deadlocks and whether the loop
actually closes.

| # | Question | Result |
|---|---|---|
| 89 | does mutual coupling **close the loop** (buying one loosens the other, both ways)? | ✅ **Yes** (devnet) — both flat → a 15.0 transfer vetoed both ways; small trades still went through (**no deadlock**); buying A up loosened B (B's 15.0 then passed), and that B buy loosened A back (A's 15.0 then passed). A virtuous cycle, reads-only. |
| 90 | does the loop close on **live Meteora trades**, both arms? | ✅ **Yes — chain-verified.** A (in a DBC pool) ↔ B: a Meteora buy of A was **vetoed while B flat** then **succeeded after B was bought** (B loosens A), and a B transfer was **vetoed while A flat** then **succeeded after A's Meteora buy** (A loosens B). Pool `L78Dig9dxyh6KZ4xBun43M47fzjJ7zQkYQ17XPTKyrw`. |
| 91 | is there a **deadlock trap**? | ⚠️ **Yes — documented.** With `base_cap = 0` on both sides, cap is 0 while both are flat, so **no transfer can ever build the pressure needed to loosen the other** — a permanent mutual freeze. Mutual coupling needs a nonzero base (a bootstrap path); verified a `base_cap=0` pair stays frozen. |

**What Batch 37 adds**
- **Index / basket tokens** — a token can track a *portfolio* of others (sum, and by
  extension weighted average) with its rule enforced inside Meteora's swap; the account
  budget comfortably fits several sibling feeds (4 extras proven; the ~10-extra ceiling
  leaves room for more).
- **Two-way coupled tokens are safe and live** — mutual reaction closes the loop on real
  trades with **no recursion** (reads-only) and **no deadlock** given a nonzero base. Lead/lag
  pairs, reflexive twins, and small coupled token *systems* are buildable primitives.
- **The one real footgun** is the zero-base mutual freeze — a clean design rule (keep a
  bootstrap path) rather than a hidden hazard.

Programs: `programs/basket` (new), `programs/pulse` (reused for the loop). Tests:
`tests/basket.ts`, `tests/feedback.ts` (green on devnet). Live Meteora:
`scripts/meteora-basket.mts`, `scripts/meteora-feedback.mts`.

---

## Batch 38 — Weighted index & three-body loops (`windex`, `pulse`)

Pushing the coupling frontier further: per-member **weights** (a real index) and a
**three-token ring**.

### Three-body ring — A → B → C → A (`pulse` ×3)  ✅ chain-verified

Three reactive tokens in a ring, each keyed to the next. Reads-only (no CPI) → no
recursion; the question was whether a longer chain propagates and stays stable.

| # | Question | Result |
|---|---|---|
| 92 | does a loosening wave **propagate around a 3-ring**, no deadlock? | ✅ **Yes** (devnet) — A's 15.0 was vetoed while the ring was cold; bootstrapping **C** (small trades) loosened **B**, which loosened **A** (its 15.0 then passed), and the wave came full circle (A's activity loosened C). Monotonic/stable — more buying only loosens, so it propagates without oscillating. |
| 93 | does the ring propagate through a **live Meteora swap**? | ✅ **Yes — chain-verified.** A (in a DBC pool) ← B ← C: a Meteora buy of A was **vetoed while the ring was cold**, then **succeeded** after bootstrapping C and building B — a wave that started **two hops away** unlocked A's live buy. Pool `CA4eHsje2PGXmPapFjLrTYJBffzdMXhnvRXPSPgah9qc`. |

**Note on stability:** the coupling here is *monotonic* (more net buying → looser), so a
ring propagates a one-way loosening wave and does not oscillate on its own. Oscillation
would require a *non-monotonic* coupling (e.g. a cap that inversely tracks the neighbor) —
a separate design worth probing. The one hazard is the same as the 2-body case: a zero base
anywhere in the ring can stall the bootstrap.

### Weighted basket index (`windex`)  ✅ chain-verified

`basket` (Batch 37) summed its members equally; `windex` carries a **per-member weight**, so a
token can track a *weighted* index — the heavy member moves its cap several times as hard as a
light one. `cap = base + step · (Σ weightᵢ·netᵢ) / unit`; weights stored parallel to the
fixed-pubkey member feeds.

| # | Question | Result |
|---|---|---|
| 94 | do **per-member weights** drive the cap (heavy member counts more)? | ✅ **Yes** (devnet) — A tracks {B×3, C×1}: **two** buys of the light member C (+6 weighted → cap 12) left a 13.0 transfer **vetoed**, but **one** buy of the heavy member B (+9 weighted → cap 15) **passed** it. A small heavy-member buy did what a larger light-member buy couldn't. |
| 95 | does the weighted index enforce on a **live Meteora swap**? | ✅ **Yes — chain-verified.** A (weighted index in a DBC pool): a Meteora buy was **vetoed while flat**, **still vetoed after buying the light member**, and **succeeded after buying the heavy member** (weight 3 → 3× the cap movement). Weights drive the cap inside the swap. Pool `2G2bJTwUxTYEVmQJKstKLHhTjNQn2xf2T7Wgk7kPT3QN`. |

Programs: `programs/windex` (new), `programs/pulse` (reused for the ring). Tests:
`tests/threebody.ts`, `tests/windex.ts` (green on devnet). Live Meteora:
`scripts/meteora-threebody.mts`, `scripts/meteora-windex.mts` (green).

---

## Batch 40 — A true autonomous on-chain oscillator (`osc`)

Batch 39 established the boundary: transfer-driven, per-direction-monotonic state can't
self-oscillate, and named the one construction that could — *an internal integrator advanced
by `Clock` on every transfer*. This builds it. `osc` carries a harmonic oscillator (position
`x`, velocity `v`) and, on each transfer, integrates it forward by the **real elapsed seconds**
in 1-second substeps (semi-implicit Euler: `v += −ω²·x ; x += v`). So `x` traces a **cosine of
wall-clock time** — it rises *and* falls on its own — and the enforced cap "breathes":
`cap = max(floor, base + x)`.

| # | Question | Result |
|---|---|---|
| 99 | can a hook maintain a value that **oscillates autonomously** (up *and* down) purely from time? | ✅ **Yes** (devnet) — sampling `x` via 0-amount ticks over ~30s traced a clean cosine: `17.4 → 4.1 → −11.9 → −20.0 → −14.8 → 0.2 → 15.1 → 20.0 → 11.6 → −4.5 → −17.6 → −19.0`. It rose and fell on its own, **bounded** at ±amplitude (the semi-implicit integrator is stable — no energy blow-up). No monotonic accumulator can do this. |
| 100 | can the oscillator **gate transfers** — flip a *fixed* transfer allowed↔vetoed over time? | ✅ **Yes** (devnet) — a fixed 45.0 transfer **PASSED** (high phase) → **VETOED** (low phase) → **PASSED** (high again). The state was driven only by the Clock; no trade moved it. |
| 101 | does it hold on a **live Meteora swap**? | ✅ **Yes — chain-verified.** The **same** Meteora buy of A **succeeded near a peak** (t≈6s), was **VETOED near the trough** (t≈43s, ½-period later), and **succeeded again at the next peak** (t≈84s). An autonomous oscillator gating a live DEX swap. Pool `Fzw8AR66Vgti6j1ptqecF7H6kgW6pD6Sb5wUmpq4upXE`. |

**Why this is the missing piece.** Every earlier state variable in the repo only moved when a
trade moved it (counters, volume, pressure). `osc`'s `x` is the first that evolves **on its own
timeline**: because each transfer integrates the *actual* elapsed wall-clock (in bounded
substeps), `x` at any transfer ≈ `amp·cos(ω·(now − seed))` regardless of trade cadence,
direction, or amount. Sparse trading doesn't stall it (the next transfer catches the integrator
up); a `MAX_DT` clamp caps the per-tick work (~CU) and keeps the integrator stable across gaps.
This closes the Batch-39 boundary: **autonomous oscillation IS achievable** — it just requires an
internal `Clock`-advanced integrator rather than a monotonic accumulator.

**Cost/stability notes.** Semi-implicit (symplectic) Euler with 1s substeps is stable for
`ω·dt < 2` — trivially satisfied here — and conserves a bounded pseudo-energy, so `x` stays in
`[−amp, amp]` (verified). Substep count is bounded by `MAX_DT` (90), a few thousand CU worst
case — comfortably inside the hook budget. `set_params` re-seeds the oscillator at a peak for
tuning; 0-amount transfers are free "ticks" (Batch 13) that just advance the clock.

**As a launch mechanic:** a **breathing cap / time-windowed token** — trading capacity that
pulses on a fixed cadence (calmer at troughs, open at peaks), with the schedule provably
on-chain and unstoppable. More generally, `osc` shows a hook can run a small **autonomous
dynamical system** driven by nothing but block time.

Program: `programs/osc`. Test: `tests/osc.ts` (oscillation + breathing cap, green on devnet).
Live Meteora: `scripts/meteora-osc.mts` (same buy flips over one period).

---

## Batch 42 — Resonance: rhythmic buying pumps the driven oscillator (`dosc`)

The last behavior of a driven-damped oscillator we hadn't exhibited: **resonance**. Drive `dosc`
at its **natural frequency** (buys in phase, once per period `T`) and the kicks add
constructively — the amplitude builds far larger than the **same** buys applied off-resonance
(anti-phase, every `T/2`), where each kick fights the motion. Same total energy; timing alone
decides. The classic resonance curve, on-chain.

| # | Question | Result |
|---|---|---|
| 105 | does driving at the **natural frequency** build a much larger amplitude than off-resonance? | ✅ **Yes** (devnet) — 4 identical buys, on-resonance (one per period `T=12s`) reached amplitude **≈ 28.3**, versus **≈ 10.0** off-resonance (one per `T/2`, anti-phase) — **2.8× bigger from timing alone**. Constructive vs destructive interference of the kicks. |
| 106 | does resonance hold on **live Meteora swaps**? | ✅ **Yes — chain-verified.** Two identical dosc DBC pools, same 4 Meteora buys each: on-resonance built amplitude **≈ 7.17** vs **≈ 2.54** off-resonance — again **2.8×** from timing. Pools `HFGZuyGjnCQSifg2iF9W2BzfWzPJN4P1bd8W4f1z4E5n` (resonant) / `7YEmmFj19Y36QYJjd9ANnhsVWWzVd91oxh2JpLQ5VZey` (off). |

**Why it matters.** This confirms `dosc` is a *faithful* driven-damped harmonic oscillator, not a
loose analogy: it exhibits the defining property — frequency-selective amplification. The same
capital deployed as buys produces a very different on-chain amplitude depending only on whether
the buying is **rhythmic at the token's natural frequency**. A hook can make a token that
literally *resonates* with a trading cadence.

**As a launch mechanic:** a **resonance token** — coordinated, rhythmic buying (a community
buying "on the beat", once per period) pumps its momentum/amplitude far more than the same volume
bought arbitrarily. A novel coordination game: the crowd that trades *in sync* is rewarded with a
higher cap / stronger flywheel than uncoordinated flow of equal size. (Tune `ω` to set the beat.)

This closes the dynamics arc: **coupling (36–39) → autonomous oscillation (40) → driven+damped
(41) → resonance (42).** A transfer hook can host a complete, faithful dynamical system — up to
frequency-selective resonance — and enforce it live on Meteora.

Program: `programs/dosc` (reused). Test: `tests/resonance.ts` (green on devnet). Live Meteora:
`scripts/meteora-resonance.mts` (resonant vs off-resonant pools).

---

## Batch 43 — Coupled oscillators: beats & normal modes (`coupled`)

The finale of the dynamics arc: **two** harmonic oscillators in one hook, integrated in lockstep
and coupled by a spring, so they **exchange energy**. Each transfer advances the full 2-DOF
system: `a₁ = −ω²·x₁ − k·(x₁−x₂) − γ·v₁`, `a₂ = −ω²·x₂ − k·(x₂−x₁) − γ·v₂`. Seed one → **beats**;
seed a **normal mode** → it stays stationary at its own frequency.

| # | Question | Result |
|---|---|---|
| 107 | do two coupled oscillators **exchange energy (beats)**? | ✅ **Yes** (devnet) — seeded all energy in oscillator 1 (osc-2 at rest), then sampling over time, **energy sloshed into oscillator 2** (E₂ rose from 3% → 55% of the initial). The two oscillators trade energy — the hallmark of coupling. |
| 108 | are the **symmetric & antisymmetric normal modes** stationary, at different frequencies? | ✅ **Yes** (devnet) — seeded `x₁=x₂` → they stayed **exactly equal** (a stationary symmetric mode, no beating); seeded `x₁=−x₂` → they stayed **exactly opposite** (stationary antisymmetric mode). The antisymmetric mode oscillated **faster** (5 vs 4 sign-changes in the same window — `ω_anti = √(ω²+2k) > ω_sym = ω`). |
| 109 | do the beats hold on **live Meteora swaps**? | ✅ **Yes — chain-verified.** Sampling the energy split via a run of live Meteora buys traced a **full beat cycle**: `98/2 → 62/38 → 32/68 → 4/96 → 1/99 → 15/85 → 55/45 → 98/2` — energy flowed entirely into osc-2 and all the way **back** to osc-1. Pool `9Vqkj6pSjENMNc2rCGbAKjaAaxKuoQomD7NkZi11suWy`. |

**What this shows.** A single transfer hook can host a **multi-degree-of-freedom coupled
dynamical system** and reproduce its textbook physics — energy exchange (beats), stationary
**normal modes**, and the frequency splitting between them (`ω_sym` vs `ω_anti`) — all integrated
correctly in lockstep (both DOFs use each other's current value each substep), stable under
semi-implicit integration, inside the hook's CU budget, and observable through live Meteora swaps.

**The dynamics arc, complete.** From the boundary result to the full system:
- monotonic coupling → stable one-way waves (36–38),
- inverse coupling → anti-correlated driven latch (39),
- Clock integrator → autonomous oscillation (40),
- driven + damped → trades supply/dissipate energy (41),
- resonance → frequency-selective amplification (42),
- **coupled oscillators → energy exchange, beats, and normal modes (43).**

A Token-2022 transfer hook is enough to run a small but faithful **physics engine** — up to two
coupled resonators trading energy — and enforce it on real trades.

**As a launch mechanic:** **paired resonators** — two tokens (or two internal modes of one) whose
"momentum" sloshes between them on a beat, or a coordination game keyed to a normal mode. More a
demonstration of the surface's depth than a fairness tool.

Program: `programs/coupled`. Test: `tests/coupled.ts` (beats + both normal modes, green on
devnet). Live Meteora: `scripts/meteora-coupled.mts` (a full beat cycle sampled by real buys).

---

## Batch 44 — Per-holder stateful accounting (`hold`)

Every prior per-owner hook only **reads** owner-keyed accounts — `ghook` gates on the
recipient's holdings, `phook` reads the owner for provenance. Batch 2's note stood: *"no
lazy per-wallet PDA creation inside a plain accumulator."* This batch **writes** a
per-RECEIVER state PDA on every transfer. The `ExtraAccountMetaList` resolves, from the
destination token account's owner field (`AccountData` @offset 32), a PDA seeded
`[b"hold", mint, dest.owner]` that belongs to this program and is marked **writable**; the
hook accumulates that one wallet's `recv_count` / `recv_volume` / `last_slot` and enforces
a **per-wallet** rule.

| # | Question | Result |
|---|---|---|
| 110 | can a hook **write** a per-receiver PDA (keyed on `dest.owner`), so state is **per-wallet** not per-mint? | ✅ **Yes.** Each receiver gets an independent slot; the hook mutates it inside Execute. Wallet A's counters advance without touching wallet B's. Holder slot is pre-created by `init_holder` (no payer inside Execute — lazy creation is Batch 45). |
| 111 | mode 0 — **per-wallet cumulative cap** (fair-launch "max per wallet"): does one wallet cap out while another is unaffected? | ✅ **Yes.** cap=1500: A receives 1000 (✅) then +1000 → **rejected** (2000 > 1500); the over-cap tx reverts so A's `recv_volume` stays 1000 / `count`=1. B receives 1000 fine — **independent slot**. |
| 112 | mode 1 — **per-wallet cooldown**, enforced on a **live Meteora swap**: is per-buyer state written by a real DEX buy and the cooldown vetoed? | ✅ **Yes.** On a DBC pool: **buy #1** wrote the buyer's slot (`recv_count`=1, `last_slot` stamped) and passed; **buy #2** inside the 25-slot window was **VETOED by the hook** (`HolderCooldown`, 6004) *on the Meteora swap*; **buy #3** after the window passed (`recv_count`=2). |

**What this establishes**
- **Per-holder mutable state is real.** A hook can maintain independent, writable state
  **per wallet** (keyed on `dest.owner`), not just one global per-mint accumulator — closing
  the Batch-2 gap. This unlocks a family: per-wallet cumulative caps (fair-launch max-per-
  wallet / anti-whale), per-wallet cooldowns (anti-spam / anti-bot), loyalty/streak tiers,
  personal vesting — all enforced inside the transfer, no off-chain crank.
- **Both a hard cap and a cooldown work, and slots are independent** — one wallet hitting its
  limit never affects another (proven with two receivers on the same mint).
- **The over-limit transfer reverts its own write**, so accumulators never actually exceed the
  cap — the veto and the state are atomic.

**Meteora integration — a real SDK limitation (worth its own note).** The stock
`@meteora-ag/dynamic-bonding-curve-sdk` (v1.5.x) resolves a hook's extra accounts **once,
against `PublicKey.default` for source/destination/owner** (`getRemainingAccountsForTransfer
Hook` in `dist/index.js`), then reuses them for every swap. So **any** extra account derived
from the *real* `dest.owner`/source (an `AccountData`/`AccountKey` seed off a base account) is
resolved against the zero address and throws `TokenTransferHookInvalidSeed` — the per-holder
slot can't be auto-resolved by the SDK. This is source-confirmed and reproduced live. The fix
in `scripts/meteora-hold.mts` is a one-method override that resolves the hook extras against
the **real** buyer, after which the live swap fires and enforces correctly. **Implication:**
per-holder (and any owner-derived-account) hooks are fully valid on-chain and on wallet-to-
wallet transfers, but are **not drop-in on Meteora's stock SDK** — a launcher needs a client
that resolves the dynamic account against the actual trader. (A Meteora-native alternative —
a single static registry account the hook reallocs/appends to, per Batch 23 — is a later batch.)

- **Confidential-transfer hygiene:** the accumulator treats `amount == u64::MAX` (the
  confidential sentinel from Batch 30) as 0, so an encrypted transfer can't poison `recv_volume`.

Program `hold` (`5WT4MG78LVweXmDGYo44AVkTeSmYeeDqfjTE1H5jAybg`). Test: `tests/hold.ts`
(mode 0 cap + mode 1 cooldown, per-wallet independence, green on devnet). Live Meteora:
`scripts/meteora-hold.mts` (per-buyer slot written + cooldown vetoed across three real buys).

---

## Batch 45 — Lazy per-holder slot creation inside Execute (`hlazy`)

Batch 44 required each holder slot to be pre-created (`init_holder`) because there is
no payer inside Execute. This closes that gap: the hook itself **creates + funds** a
receiver's state PDA on their **first** transfer, paying rent from a pre-funded,
system-owned pool PDA — the "manna" reward-slot pattern, now re-proven in-repo.

| # | Question | Result |
|---|---|---|
| 113 | can a hook **create + fund a per-receiver PDA during Execute** (no payer at transfer time), so a wallet needs **zero pre-registration**? | ✅ **Yes.** First transfer to a fresh wallet: its slot was **absent** before and **program-owned + initialized** after (`recv_count`=1) — the hook `system_instruction::transfer`'d rent pool→slot (pool signs by seeds), then `allocate`+`assign`'d the slot to itself (slot signs by seeds) and wrote state. Second transfer accumulated (`count`=2); a second wallet got its own slot independently. Lazily-created slots enforce the same per-wallet cap (mode 0). |
| 114 | does lazy creation work on a **live Meteora swap** — the first BUY creates the buyer's slot? | ✅ **Yes.** On a DBC pool, buyer never registered: **buy #1** *created* the buyer's slot (program-owned, `count`=1), funded from the hook's pool; **buy #2** inside the cooldown was **VETOED** (`HolderCooldown`); **buy #3** after the window passed (`count`=2). |

**What this establishes**
- **Per-holder accounting needs no pre-registration.** The hook lazily mints each
  wallet's state slot on first contact and funds the rent itself — so per-wallet caps /
  cooldowns / loyalty work for **any** buyer the moment they trade, including the very
  first swap, with no setup transaction from the user. This is the mechanism that makes
  Batch 44's per-holder family actually deployable.
- **The lamport dance that works:** a manual `**lamports -= / +=` juggle trips the
  runtime's balance-conservation check; the correct pattern is a **system-program
  `transfer` from a system-owned pool PDA** (pool signs by seeds) → `allocate` →
  `assign` (slot signs by seeds) → write. All inside the ~15.8k-CU hook budget.
- **Funding model:** rent comes from a per-mint pool PDA the creator pre-funds at launch
  (0.05 SOL funds ~45 slots at ~0.0011 SOL each). The pool is a plain system-owned
  lamport reservoir; when it runs dry, new-holder transfers fail until it's topped up —
  a knob to size at launch.

Same Meteora-SDK caveat as Batch 44 (the stock resolver uses `PublicKey.default`, so the
per-holder account is resolved via the one-method override in the script).

Program `hlazy` (`GaFtqyc9vCurVxPtQHKSyg66KeVp7rBwQL6Mkwj9U51y`). Test: `tests/hlazy.ts`
(slot absent→created-by-hook, per-wallet independence, cap on lazy slots, green on devnet).
Live Meteora: `scripts/meteora-hlazy.mts` (first buy creates the slot; cooldown vetoed).

---

## Batch 46 — CPI stack-depth / router detection (`depth`)

Batches 6 and 22 read the *caller* (Instructions sysvar) to reason about a
transfer's context, with the caveat that under a DEX/aggregator the top-level
instruction is the router, not the transfer. This batch reads a cleaner signal —
`get_stack_height()` — to tell **how** the transfer was invoked, and gates on it.

| # | Question | Result |
|---|---|---|
| 115 | can a hook read its **CPI stack depth** and distinguish a **direct wallet transfer** from a **DEX-routed** one? | ✅ **Yes.** A direct top-level `transfer_checked` runs the hook's Execute at **depth 2** (token program at the tx level → hook one frame down); a **Meteora swap** routes the token transfer under the swap instruction, so the same hook runs at **depth 3**. Read live via `get_stack_height()` and recorded in state. |
| 116 | can it **gate** on that — block a DEX swap while allowing wallet transfers (or the inverse)? | ✅ **Yes, on live Meteora.** mode 0 (**P2P-only**): a direct transfer passes (depth 2) but the **Meteora buy is VETOED** (`NotDirect`, depth 3). mode 1 (**routed-only**): the direct transfer is vetoed but the **Meteora buy passes**. Same program, opposite policy by one config byte. |

**What this establishes**
- **A hook knows whether it's inside a swap.** `get_stack_height()` cleanly separates
  a top-level wallet transfer (depth 2) from any program-nested transfer (depth ≥ 3) —
  no instruction-introspection heuristics, no router-address allowlist. Recorded in state
  so it's also observable off-chain.
- **New behavioral axis:** a token can be made **P2P-only** (moves between wallets but
  cannot be bought/sold on an AMM — a soulbound-ish / OTC-only / airdrop-locked token) or
  **DEX-only** (blocks raw wallet transfers, forcing all movement through a program). This
  is the constructive flip side of Batch 6/22's "instruction-presence rules break open
  tradability": here the depth *is* the rule.
- **Caveat (honest):** depth-2-vs-3 is the boundary for a *single* router hop (Meteora
  DBC). A deeper aggregator (Jupiter → AMM → token → hook) nests further, so "direct" is a
  precise test (`depth <= 2`) but "routed" covers everything deeper; a hook that must
  distinguish *specific* venues still needs a caller/program check on top. And a P2P-only
  token is, by construction, not DEX-tradable — a deliberate, niche choice.
- No client resolver override needed here — the sole extra account (`cfg`) is keyed on the
  mint, so Meteora's stock resolver handles it (contrast Batches 44/45).

Program `depth` (`4FYZUzNqHxLRLs8bhoQf71yRW8i2jPxJxLZJFcqB9Xom`). Test: `tests/depth.ts`
(direct = depth 2; P2P-only passes / routed-only vetoes a direct transfer; green on devnet).
Live Meteora: `scripts/meteora-depth.mts` (swap = depth 3; P2P-only vetoes the buy, routed-only allows it).

---

## Batch 56 — Token dividends: per-buyer classic-SPL reward, minted on claim (`drip` mode 2)

Extends `drip` with a third mode. A hook can't move the hooked Token-2022 coin (the reentrancy
wall, #127–130), but it can hand out a *separate* classic-SPL token — the same escape hatch
`emit`/`manna` use. So token dividends work like the SOL kind, but the payout is a branded
reward token: each buy accrues a fixed amount to the buyer's slot (a counter — no CPI on the
hot path), and `claim_token` mints what they're owed, signed by the `["auth"]` mint authority.

| # | Check | Result |
|---|---|---|
| 152 | **Token dividends** end-to-end through the Lattice pipeline on live Meteora | ✅ A buy accrued **1,000 reward tokens** to the buyer's slot; `claim_token` **minted them to the holder** (classic-SPL `mint_to` via `["auth"]`, no reentrancy — the hooked coin is never touched); the slot's `token_owed` reset to 0. |

**What this establishes**

- **Per-buyer token rewards are DBC-viable**, complementing the pooled `emit`/`distrib` model:
  `emit` mints to a global vault claimed pro-rata by stakers; `drip` mode 2 pays each buyer
  directly, claimable per holder. Same "reward is classic-SPL" principle, different
  distribution.
- **No CPI on the swap path.** Accrual is a counter write inside `Execute`; the only mint
  happens in `claim_token`, an ordinary instruction the holder sends — so the hot path stays
  cheap and can never hit the reentrancy wall.
- The reward token reuses Lattice's existing branded-side-token launch flow (name/symbol/image,
  authority handed to the hook's `["auth"]` PDA) — identical to `emit`, so `claim_token` mints
  through the same authority.

`drip` upgraded in place (`3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo`); `initialize` gained a
`side_mint` arg and `Slot` a `token_owed` field. Shipped in Lattice as **"Token dividends"**
(Rewards family, `meteora: "client"`). Verified end-to-end in `lattice/scripts/verify-drip.mts`.

## Batch 59 — Rolling waitlists, exit tolls, two-class launches, conviction caps, referral trees (`gatekeep`, `drip` 5–7)

Five LAUNCH-IDEAS entries (#67, #71, #70, #69, #68) productized in one pass, all driven through
live Meteora DBC pools. Two of them turned up results worth recording beyond "it works".

| # | Check | Result |
|---|---|---|
| 157 | `gatekeep` with a Merkle root that an authority can **replace** (`set_merkle_root`), then permanently **freeze** (`freeze_root`): launch with wave 1, try a wallet only in wave 2 | ✅ Rejected. |
| 158 | Publish wave 2 (new root, on-chain `version` bumps), retry the same wallet | ✅ Admitted. A waitlist can genuinely open in stages without redeploying or relaunching. |
| 159 | Call `freeze_root`, then try to publish wave 3 | ✅ Rejected permanently. `frozen` is one-way. |
| 160 | `gatekeep` mode 3 (exit toll): buy | ✅ Free — the toll is **sell-side only** (see below). |
| 161 | Sell 100,000 tokens, then 300,000, with the toll set to 0.05 SOL per 100k | ✅ Paid **0.05 SOL** then **exactly 3×** that. Charged in lamports per 1,000 tokens, computed identically on-chain and client-side. |
| 162 | `drip` mode 5 (two-class): buy inside the presale window, then try to sell | ✅ Rejected — `StillVesting`. Presale buyers are vested by their own clock. |
| 163 | Same token launched with the window already closed: buy, then sell | ✅ Succeeds. Class is decided by `first_slot` vs the cutoff, so one mint has both a locked presale class and a liquid public class with no snapshot and no second token. |
| 164 | `drip` mode 6 (conviction cap): buy under the starting cap, then a buy far over it | ✅ First passes, second rejected (`OverConvictionCap`). The cap grows per period held, so *how long a wallet has held* sets how much more it may buy. |
| 165 | `drip` mode 7 (referral): a second wallet buys through a referral link | ✅ The `["ref", mint, buyer]` record is created **in the same transaction as the buy**, and stores referrer + mint + buyer. |
| 166 | Same buy, 0.01 SOL dividend at a 40% referrer share | ✅ **0.0040 SOL** accrued to the referrer, the rest to the buyer; the referrer's claim swept the record back to rent exactly. |
| 167 | Re-bind a different referrer for the same buyer; and bind yourself | ✅ Both rejected (init-once PDA; `SelfReferral`). A referrer can't be rewritten or switched off later, which is the only thing that makes a referral promise worth anything. |

**⛔ A hook cannot charge a fee proportional to a BUY's token output.** The exit toll was designed
symmetric and had to be cut back to sell-only. On a buy, the number of tokens the curve returns is
decided *inside* the swap, so no client can attach a provably-correct payment instruction before
the fact, and the hook can only verify payments that are already in the transaction. On a **sell**
the token amount is the input — known to both sides — so the same rule is enforceable exactly.
Any "% of the trade" hook mechanic inherits this asymmetry.

**⛔ A hook cannot resolve an account named by transaction data.** The referral tree's first design
read the referrer out of an SPL Memo. It can't work: the ExtraAccountMetaList is fixed at launch
and can only derive accounts from seeds it already knows (literals, other account keys, bytes at
fixed offsets in the accounts it's given). A referrer chosen at trade time is none of those. The
working shape is to bind the referrer to a PDA the resolver *can* derive — `["ref", mint, buyer]`
— in a separate instruction that the client prepends to the same transaction, so the referred
buyer still signs once.

**Schema note.** Mode 7 is the only mode with a sixth extra account. Appending it conditionally
keeps every `drip` token launched before mode 7 existed on its original five-account layout —
finding 146 again: a deployed hook's account list and account structs are effectively frozen for
every token already using them.

`gatekeep` `3uxoNzXj…`, `drip` `3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo`.

---

## Batch 60 — A treasury the TOKEN governs: holder-count milestones + an abandonment refund (`treas`)

LAUNCH-IDEAS #73 and #74 both wanted the same thing this repo had never built: **money locked at
launch that only the hook's own bookkeeping can release**. Both are now one program, `treas`,
and both were driven end-to-end through a live Meteora DBC pool.

The design decision worth recording is what gets *counted*. #73 was written as "at 100 SOL of
volume, release a tranche", and that is **not buildable honestly**: a hook sees token amounts,
never SOL, and the SOL legs of a Meteora swap happen inside CPI where the Instructions sysvar
can't see them (Batch 6/22). Even if it could, volume is wash-tradeable by one wallet in a loop.
So `treas` counts **distinct holders** instead — each first-time receiver lazily opens a slot
(the Batch 45 pattern), which costs real rent and a real minimum buy every time. Same promise,
a metric that isn't free to fake.

| # | Check | Result |
|---|---|---|
| 168 | Launch a DBC token with `treas` mode 0 (milestones at 2 / 50 / 250 holders, 0.4 SOL locked); buy from one wallet, then call `release` | ✅ Counter reads **1 distinct holder**; the release is **rejected** — a creator cannot pull a tranche forward. |
| 169 | A second wallet buys, then `release` | ✅ Counter reads **2**, the milestone is crossed, and **0.1333 SOL** (one third of what's free, one tranche of three) lands at the beneficiary fixed at launch. |
| 170 | Call `release` again at the same milestone | ✅ Rejected. One tranche per milestone, tracked by an on-chain `released` index. |
| 171 | Call `release` with a *different* beneficiary account | ✅ Rejected — the destination is compared against the pubkey stored at launch, so the tranche can't be redirected. |
| 172 | Launch mode 1 (abandonment refund, 0.3 SOL locked); buy, then immediately `unlock` | ✅ Rejected: `Clock.slot - last_slot < idle_slots`. Every transfer stamps `last_slot`, so any trade keeps the token "alive". |
| 173 | Same, with a ~22-slot window: two wallets buy (0.04 and 0.08 SOL), wait past the window, `unlock` | ✅ The refund opens and **snapshots 0.300 SOL**, freezing `claim_base` = tokens tracked at that moment. |
| 174 | Each holder calls `claim_refund` | ✅ Shares are exactly pro-rata: **0.1003 / 0.1997 SOL** on a 1:2 holding split; the larger holder's claim paid out **+0.1997 SOL** to the nanolamport. |
| 175 | Claim twice; and claim from a wallet that never held | ✅ Both rejected (`refunded` flag on the slot; no slot at all for the stranger). |
| 176 | Inspect the vault account | ✅ Owned by `treas`, not by the creator. There is **no withdraw instruction** — `release` and `claim_refund` are the only paths out, and both are permissionless. |

**What this establishes**
- A hook program can hold a real SOL treasury whose *release conditions are enforced by the hook's
  own trade bookkeeping*, with no admin key, no multisig, and no off-chain trigger. Both
  instructions are permissionless: the creator can't withhold, accelerate, or redirect.
- **Pro-rata payout from hook-maintained balances works.** `received - sent` per slot, summed into
  a `tracked` total on the config, is enough to split a snapshot exactly. This is the reward-
  delivery shape Batch 34's `distrib` proved for tokens, now proven for SOL from a locked vault.
- ⚠️ **"Abandoned" is only ever a proxy.** One wash trade inside the window resets the clock
  forever. That's disclosed in Lattice's own copy rather than papered over — the mechanism is
  honest about what it can and can't detect.
- ⛔ **SOL-denominated volume milestones are not buildable in a hook.** Recorded here so it isn't
  re-attempted: the hook sees token amounts only, and Meteora's SOL legs are invisible to it.

Program `treas` `B2YVN1bWc95pSDBcZTpKgaH3v2JbmNKWRE5rSYNQ1m2x`.
Devnet tokens: milestone `77Du5Ah9CY63Jx3zBfShnM8wjQRxPds8vwKWS3MG1TbG`, refund
`2Eb82gcbaLaKFU6V2XzAGYzQmnxW8Ei4QLEkfThmAkig`.

---

## Batch 61 — Reading a gate token as an AMOUNT: tiered membership (`dues.initialize_tiered`)

Batch 54's `dues` gate is binary — hold ≥1 of the gate token or the transfer is rejected. #72
asked whether the same single ATA read can drive a **ladder**. It can: the balance is already in
bytes 64..72 of the account the resolver hands over, so reading it as a number instead of a
boolean costs nothing extra.

| # | Check | Result |
|---|---|---|
| 177 | Launch a DBC token with `initialize_tiered` (bronze 1,000 gate tokens → 0.02% cap, silver 10,000 → 1%, gold 100,000 → uncapped); hold 2,000 and buy 0.05 SOL (~1.6M tokens, far over the bronze cap) | ✅ **Rejected** — `OverTierCap`. |
| 178 | Same wallet, same tier, buy 0.005 SOL (~166k, inside the 200k bronze cap) | ✅ Passes. |
| 179 | Top the gate holding up to 120,000 (gold rung), repeat the 0.05 SOL buy | ✅ **Passes** — the cap comes off. The tier is re-read from the live gate balance on every single transfer, so a wallet's rung changes the moment its holding does. |

**What this establishes**
- One ATA read supports arbitrary **threshold** ladders (not curves — the tier table is a fixed
  3-entry array in a PDA, which is what keeps it inside the CU budget).
- ⚠️ The cap is **per transfer**, not cumulative. `dues` keeps no per-holder state, so a running
  total isn't something it can enforce; the UI says so rather than implying otherwise. A
  cumulative version would need `drip`/`treas`-style lazy slots.
- ⚠️ It makes the gate token's *price* the real gatekeeper — thin gate-token liquidity means tiers
  whipsaw. Unchanged from the #72 write-up; noted, not solved.

**Schema note (the pattern this repo now uses by default):** `Du` was already deployed and live,
and adding a field to an Anchor account struct breaks every existing token (Batch 47 / finding
146). So the tier table lives in its own `["dutier", mint]` PDA appended as a **seventh** extra
account, and only by the new initializer — tokens launched with plain `initialize` keep their
six-account meta list byte-for-byte. The hook reads the tier PDA out of `remaining_accounts` and
verifies the derivation before trusting it. Same shape as `drip` mode 7's referral record.

---

## Batch 62 — A holder cap that loosens on a clock, with seats that free themselves (`treas` mode 2)

"Only N wallets may hold this, and N grows over time" turns out to be two things this repo had
already proven, wired together: Batch 60's distinct-holder counter and Batch 59's clock-grown
per-wallet cap (`drip` mode 6). The interesting part is not that it works — it's what had to be
true for it to work without adding a single field to a deployed account.

**Seat occupancy is derived, never stored.** A wallet occupies a seat exactly when
`received > sent` on the slot the hook already maintains. So the hook increments on the
transition `0 → positive` and decrements on `positive → 0`, and there is no `counted` flag to add
to `Slot` and no new counter to add to `Tr`. Finding 146 stays satisfied: every `treas` token
launched in mode 0 or 1 keeps its account layout and its five-account meta list byte-for-byte,
and mode 2's schedule lives in its own `["trcap", mint]` PDA passed as a sixth extra.

| # | Check | Result |
|---|---|---|
| 180 | Launch a DBC token with 2 seats, +1 every 600 slots, ceiling 4; read the schedule PDA | ✅ On-chain and immutable — there is no setter, so the ramp a launch advertises is the ramp it keeps. |
| 181 | Two wallets buy | ✅ Both seated; counter reads 2. |
| 182 | A third wallet buys while the cap is still 2 | ✅ **Rejected** — `HolderCapFull`. |
| 183 | A seated wallet buys again | ✅ Passes, and the counter **stays at 2**. The gate fires on entry, not on size — topping up an existing position is never blocked. |
| 184 | A seated wallet sells its **entire** position | ✅ Counter drops to 1 in the same transaction. The seat is freed on the sell itself, not by a cron or a claim. |
| 185 | The wallet that was turned away in #182 retries | ✅ Admitted into the freed seat. |
| 186 | Wait past one period, then a fourth wallet buys with nobody having left | ✅ The clock widened the cap to 3 and the wallet was admitted. |

**What this establishes**
- A hook can enforce a **global** invariant across all holders (how many wallets hold at once),
  not just per-wallet ones. Every prior cap in this repo was per-wallet; this one requires the
  shared counter to be correct under interleaving, which the `0 ↔ positive` transition rule gives
  for free — it is idempotent with respect to transfer size and can't double-count a top-up.
- **Counting semantics have to differ by purpose, and that is a design choice worth stating.**
  Modes 0/1 count holders *ever seen* (a funding milestone shouldn't un-cross because someone
  left); mode 2 counts holders *right now* (an unoccupied seat should be available). Same field,
  two meanings, selected by mode.
- ⚠️ **It caps wallets, not people.** Each extra wallet costs slot rent plus the configured
  minimum first buy — friction, not a guarantee — and the cap says nothing about *how much* any
  seated wallet holds. Pair with a per-wallet max if concentration is the concern.
- ⚠️ **Seats are first-come-first-served within a slot.** There is no queue; block ordering
  decides who gets the last seat.

**Test note worth keeping.** The first run of the verification failed at #182 because the test's
period (~16 s) was shorter than a devnet round-trip — the cap widened between the second and
third buy, so the rejection never fired. The program was right and the test was wrong. Any
clock-driven hook needs a period that comfortably outlasts confirmation latency, both in tests
and in production copy.

Program `treas` `B2YVN1bWc95pSDBcZTpKgaH3v2JbmNKWRE5rSYNQ1m2x` (`initialize_capped`).
Devnet token `2t5StWtof5jTRsMwyYKtbkEjB816JDn9Mt3taHWkp4JQ`.

## Batch 64 — Buys only inside one app's program: "Pump App only" (`appgate`)

FOMO-only (cosign) works because FOMO co-signs every trade with one fixed wallet. The pump.fun
app doesn't: across 101 of its trades, two different pump fee-payer wallets co-signed 38 and 61 had
no pump signer at all. What every Pump-app trade *does* have is a top-level call to the Pump app's
own program `6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB`. `appgate` gates a BUY on that:
`load_current_index_checked` + `load_instruction_at_checked` on the Instructions sysvar give the
top-level instruction executing right now (the one whose CPIs reached the swap and this transfer);
its program id must equal the configured `app_program`. Merely appearing elsewhere in the
transaction does not count. pump.fun's shared router `proVF4pM…` is deliberately NOT accepted — on
Hooked pools FOMO's wallet paid for 130 of 183 router trades, so it isn't pump-app-specific.

| # | Check (devnet, live DBC, stand-in apps) | Result |
|---|---|---|
| 188 | app = Memo: creator's dev buy outside the app | ✅ passes (creator exempt) |
| 189 | app = Memo: stranger's plain buy / buy with a Memo ix elsewhere in the same tx | ✅ `NotThroughApp` both |
| 190 | app = Memo: wallet-to-wallet send; sell into the pool | ✅ both pass |
| 191 | app = DBC program (so a plain buy IS running inside the app's call) | ✅ passes |

**What this establishes**
- The Instructions sysvar's *current index* turns "is program X in this tx?" into "is program X the
  one executing this transfer?", which is what an app-only gate needs.
- ⚠️ Weaker than a co-signer: a program is public, so anyone able to call the Pump app program
  directly passes too. It pins the route, not the person.
- ⚠️ Not yet observed live: no Pump-app buy of a Hooked token was found in the sampled history, so
  the first mainnet launch confirms the app wraps DBC swaps in its top-level call.

Program `appgate` `BXax2KXrnT7qRf7cva9cLJpqDGXWywsw4ucLwtGiTa28` (devnet + mainnet). Devnet tokens
`7HLTFtWv61VzWzQDghaGnc2sUbUvNtFNfzYYCQEnGWSv` (P), `CqXmTvhdDbux6nyuajNe6qLLt4uQ6pCL1JL3FDgZ5TUk` (Q).

## Batch 65 — A max per wallet that rises on a timer, with no per-wallet state (`timecap`)

The Vise (evolve mode 1) tightens a cap on a clock; `timecap` runs the clock the other way for a
launch: every wallet's max holding starts at `start_ppm` of supply when the rule goes on and, every
`interval_secs`, adds `step_ppm` (fixed step) or doubles. It never stops; once the cap reaches 100%
it no longer limits anything. Stateless: each check reads the receiving wallet's balance after the
transfer (amount@64), the supply (mint supply@36) and the clock, so there are no per-wallet slots
and no rent pool. One read-only extra (cfg PDA), so any DEX routes it. Pool authorities and the
creator are exempt.

| # | Check (devnet, live DBC, 1-minute timer) | Result |
|---|---|---|
| 192 | minute 0, fixed 0.1% + 0.1%/min: creator 0.49% buy (exempt) · stranger ~0.25% buy · 0.073% buy · wallet send past the cap | ✅ pass · `OverCap` · pass · `OverCap` |
| 193 | minute 0, doubling from 0.1%: ~0.15% buy | ✅ `OverCap` |
| 194 | ~2 min later: fixed token buy up to 0.269%; doubling token the same ~0.15% buy; sell into pool | ✅ all pass |

Program `timecap` `6AH1GVkqUdYCrbse28TcFSLyYTSiYqQVneaxvSBTSyp3` (devnet + mainnet). Devnet tokens
`8JZDPmGpCAzUE3EtMwdxGmY7eoBJHS4urDct3vJi4uBT` (fixed), `CE6uzA8s5hyvLEAmxSNFizewjxofVp9N4e6iEiDPjpc` (doubling).

## Batch 66 — The sniper-fee cap: refusing buys that outbid everyone at launch (`feecap`)

Snipers win launches with priority fees and tips. Measured on 76 launch-window buys of Hooked
tokens on mainnet: FOMO p90 0.00016 SOL priority, pump router 0.00007, direct p90 0.00012 — and an
outlier at 0.008 SOL. Tips were top-level System transfers to Jito's 8 tip accounts and to other
relays (e.g. Astralane `AStRA…`/`astra…`). `feecap` reads the whole transaction through the
Instructions sysvar and, for `window_secs` after the rule goes on (0 = forever), refuses a BUY
whose priority fee (SetComputeUnitPrice × SetComputeUnitLimit, or the runtime default of 200k CU per
instruction / 3k per System instruction, capped at 1.4M) or Jito tips exceed the caps. No per-wallet
state; sells, wallet sends and the creator are never gated.

| # | Check (devnet, live DBC, 90 s window, caps 0.001 SOL) | Result |
|---|---|---|
| 195 | creator buy at 0.003 SOL priority | ✅ passes (exempt) |
| 196 | stranger at 0.003 SOL priority / 0.0009 SOL / 0.00003 SOL | ✅ `PriorityFeeTooHigh` / passes / passes |
| 197 | Jito tip 0.002 SOL / 0.0005 SOL in the buy tx | ✅ `TipTooHigh` / passes |
| 198 | sell at 0.015 SOL priority inside the window; 0.003 SOL buy after the window | ✅ both pass |

**What this establishes**
- Compute-budget instructions must be top-level, so the priority-fee cap can't be hidden.
- ⚠️ The tip cap is best effort: a tip paid inside another program's CPI, or in a separate
  transaction of a Jito bundle, isn't visible to the hook. Pair with Anti-bundle / a wallet cap.

Program `feecap` `BPVEVJfsDvPQ4A8oRntVudUAJyaUvFuSJVk5tidKz7Fp` (devnet + mainnet). Devnet token
`BtJnL4w6pJQ4XJPpsfn46KDZSsxTQ8NW6MbVVYB742WV`.

## Batch 68 — Market hours: a token that keeps the stock market's calendar (`hours`)

Pure clock logic, no state and no oracle: the token trades only during the NYSE regular session,
Mon–Fri 9:30–16:00 New York time. New York time is derived from `Clock::unix_timestamp` with the US
daylight-saving rule (2nd Sunday of March 07:00 UTC → 1st Sunday of November 06:00 UTC = UTC−4,
else UTC−5); NYSE full-day holidays are computed for any year (floating Mondays, Thanksgiving, Good
Friday from the Easter algorithm, and the four fixed dates with NYSE's Saturday/Sunday observance,
including the "no Friday closure for a Saturday New Year's Day" exception). Options: sells stay
open; ignore holidays. Wallet-to-wallet sends always work; the creator can always buy.

| # | Check | Result |
|---|---|---|
| 203 | `cargo test`: session edges in EDT and EST, both DST switches, weekends, 22 holiday dates (2022–2027), open days next to holidays | ✅ 8/8 tests |
| 204 | devnet, chain clock Thu 12:04 PM New York (open): creator buy, stranger buy, wallet send, stranger sell on both variants | ✅ all pass |
| 205 | devnet, after 16:00: stranger buy `MarketClosed`; sell refused / allowed per variant | see scripts/check-hours-closed.mts |

⚠️ Early closes (1pm days) aren't modelled. With sells closed after hours, holders can't exit
overnight or at weekends — by design, but scanners may flag it.

Program `hours` `EZet2oSoussVujse5U8W4T2NZsTuJ1rZBqQ8J188iJKk` (devnet + mainnet). Devnet tokens
`2eMzFaJUWZsLuA1SNPrPDSWRLj7hadMnsp4qXkrszFUp` (all closed), `DpFk7A8ivGB1u4oMCyxWjV2fqMeg3YMDLFGZYtrnsNfB` (sells open).

## Batch 69 — App-only tokens can't graduate by themselves, and the keeper that finishes them (`cosign`)

Found on mainnet (FOMO-only token `FoZocjKnQtb1bTqrXiVNfzAiNAdCmtnj7AUJMPga3nvM`): the curve reached
~99.9% and then every FOMO buy failed with DBC `InsufficientLiquidity` — FOMO sends fixed ExactIn
buys, and each was bigger than the sliver left. On an ordinary token a bot's PartialFill buy takes
the remainder; here the hook refuses any buy FOMO didn't co-sign, so nobody could. The price fell
back from the ceiling.

| # | Check (devnet, curve 0.02 SOL short of its threshold) | Result |
|---|---|---|
| 206 | co-signed ExactIn 0.2 SOL buy (FOMO's shape) | ❌ `InsufficientLiquidity` (hook never runs) |
| 207 | NOT co-signed PartialFill buy (bot) | ❌ `NotCoSigned` — the hook runs on the completing swap; `revoke_transfer_hook` comes after the transfer |
| 208 | co-signed PartialFill buy / the creator's PartialFill buy | ✅ completes the curve, hook revoked |
| 209 | after upgrade: stranger PartialFill still `NotCoSigned`; KEEPER wallet buys; finisher worker completes the curve for 0.0217 SOL, books it against the buyback reserve, re-run is a no-op | ✅ scripts/e2e-finisher.mts 8/8 |

Fix (FOMO-only only, by the owner's decision): `cosign` exempts one fixed wallet, the Hooked
flywheel wallet `2oXT6oMgNPfToahWG48QTBPWS9UJ8a7TSSeEoeoSLMGt` (`KEEPER`). A worker
(Hooked `app/lib/finisher.ts`) buys the remainder when a FOMO-only curve has ≤ 0.5 SOL left and sells
the tokens after graduation. The creator (already exempt) also gets a "Finish the curve" button.
Pump App only (`appgate`) and combined tokens with FOMO-only keep the stall risk; only their creator
can finish those. ⚠️ Any gate that restricts WHO may buy must leave someone able to send the
curve-completing PartialFill.

## Batch 70 — An app-only token dies with its app's router; opening one token by mint (`cosign`)

Found on mainnet (FOMO-only token `3YJSqXQkN5gXoZkHrHFnAMKwqyGv7B7WmRdyYVFAXnmh`, "UpSideDownCat",
ticker `USDC`): 40 minutes of FOMO trading, then nothing. Nothing on-chain had changed. The router
behind FOMO and Jupiter Ultra (OKX) stopped quoting this one token in both directions while quoting
every other FOMO-only token; OKX lists it under "similar name tokens: USDC", so the ticker is the
likely reason (not proven). The hook only lets FOMO's co-signer buy, so once the app stopped, the
token had no buyers at all. Sells kept working for anyone trading the pool directly.

| # | Check (mainnet, simulated unless noted) | Result |
|---|---|---|
| 210 | before: buy co-signed by FOMO / holder sells everything | ✅ both pass — the hook and pool were fine |
| 211 | before: Jupiter Ultra quote, buy and sell | ❌ "Failed to get quotes" (36 other permanent-curve tokens with the same config: ok) |
| 212 | after upgrade: buy with no co-signer on the opened mint | ✅ passes |
| 213 | after upgrade: buy with no co-signer on another FOMO-only token | ❌ `NotCoSigned` (unchanged) |
| 214 | after upgrade: real buy and sell on Axiom (the owner) | ✅ |

Fix (this one token, by the owner's decision): `cosign` has an `OPENED` list of mints whose buys
skip the gate. A cfg account has no update instruction, so opening a token means adding its mint
and upgrading. Devnet regression: scripts/e2e-cosign.mts 7/7 (the opened branch itself can only run
on mainnet, where the mint exists). ⚠️ An app-only rule makes the token depend on the app AND on
whatever the app routes through; a block anywhere in that chain leaves holders with no buyers.

## Batch 71 — Caps that change at market-cap levels (`slidecap`)

A new, separate program (no existing hook was changed): `asym`'s two-sided caps (Batch 52) driven
by `capgate`'s price read (Batch 59). The creator sets the max per buy and max per sell at launch
and up to 5 market-cap levels where they change; the hook reads its own DBC pool's sqrt price on
every trade and applies the highest level reached. No per-wallet state, nothing to fund, no
exemptions. One extra account beyond cfg: the pool, as a fixed address, so any router resolves it.

| # | Check (devnet, real Meteora trades; levels at 2.6 and 3.4 SOL market cap) | Result |
|---|---|---|
| 215 | launch level (buy 2%, sell 1%): 2.6% buy / 1.2% sell refused, 1.6% buy / 0.4% sell pass | ✅ |
| 216 | level 1 (buy 1%, sell 0.01%): 1.5% buy and 0.4% sell now refused; 0.011% sell refused, exactly 0.01% (100,000 tokens) passes | ✅ |
| 217 | level 2 (no buy cap, sell 0.5%): a 3% buy passes, a 0.6% sell is refused | ✅ |
| 218 | wallet-to-wallet send over every cap | ✅ never capped |
| 219 | **the hook sees the pool's price AFTER the swap**: a 1.5% buy at level 0 (cap 2%) that would cross into level 1 (cap 1%) is refused; a 0.45% sell at level 2 that would cross under it into level 1 (cap 0.01%) is refused; a 1.5% buy just under level 2 that crosses back into it (no buy cap) passes | ✅ a trade is judged by the level it LANDS in |
| 220 | a stranger calling `initialize` before the creator | ❌ `NotCreator` — the pool account names its creator (@104), so the launch's two transactions can't be split by someone setting levels of their own |

DBC writes the new sqrt price into the pool before it moves the tokens, so a hook that reads the
pool mid-swap reads the post-trade price (capgate's Beacon only ever compared against a high-water
mark, so it never showed). ⚠️ Any price-banded rule is therefore evaluated at the landing price:
nobody can jump a band with a trade the next band would refuse, in either direction.

Program `slidecap` `8uDCgT4KrMNsX6nJzqCFtLansP9AJef4deWWBk4nG9VA` (devnet). Test: Hooked
scripts/e2e-slidecap.mts, 20/20.

## Batch 73 — Pump only after all: the app's own tag is invisible, but Jupiter's tag for apps isn't (`appgate` v3)

v2.1 worked in the Pump app but let jup.ag in. Two facts from real Pump-app buys made a tighter
rule possible:

| # | Finding | |
|---|---|---|
| 228 | The Pump app's tag `…nopainnogain` is appended to the transaction's KEY LIST with no instruction referring to it (key #18 of 19, static, 0 references, in 186 of 186 buys of a Meteora token) | ❌ a program can never see it: the Instructions sysvar lists instruction accounts only. The tag check of v2, and of the competitor's hook, never fired on these buys |
| 229 | The swap Jupiter builds for the Pump app carries `jitodontfront1111111111111111JustUseJupiter` INSIDE the OKX-router instruction; jup.ag and the public Ultra API carry `jitodontfront11111111111JustUseJupiterU1tra` | ✅ visible, and present in Jupiter's dry run too |
| 230 | on our three busiest tokens under v2.1: 328 buys with the app-API tag were Pump's (Pump tag in the key list), 5 carried the app-API tag without Pump's, 31 were jup.ag's, 8 plain OKX | the app-API tag is ~98.5% Pump |
| 231 | experiment on mainnet (either Jupiter tag required inside the OKX instruction): Jupiter Ultra still builds and simulates 6 of 6 | ✅ the dry run that decides whether a transaction is built sees Jupiter's tag |
| 232 | v3 (app-API tag only): a saved jup.ag transaction / the same with the app-API tag swapped in / asking Jupiter again | ❌ `NotThroughApp` / ✅ passes / ❌ "Failed to get quotes" on 5 of 5 |
| 233 | real trades in the first minutes after the v3 upgrade, four busiest tokens | ✅ 27 Pump-app buys landed; 0 jup.ag buys; Axiom and bot buys refused; sells open for everyone |

v3: a buy passes when the instruction RUNNING it is the OKX router, that instruction lists the
app-API tag, and the transaction isn't FOMO's. Devnet has no OKX router, so devnet only proves
the refusals (scripts/e2e-appgate.mts 13/13); the passing path is proven on mainnet above.
⚠️ What still gets through: another app on the same Jupiter API, and anyone who builds that
instruction by hand. ⚠️ The rule now depends on a string Jupiter chooses; if it changes, buys
stop until the program is upgraded.

## Batch 74 — "Social trading": buys in FOMO or the Pump app, one hook (`social`)

FOMO-only (`cosign`) and Pump App only (`appgate` v3) can't both be switched on in a combined
hook, where every rule must pass: one demands FOMO's signature, the other refuses FOMO's
transactions. So "either app" is its own rule and its own program: a buy passes when FOMO signed
the transaction, OR the instruction running the buy is the OKX router and lists Jupiter's app-API
tag (Batch 73). The creator is exempt; sells and sends are open; only the pool's creator can
switch the rule on. The three addresses are the program's own by default (one upgrade fixes every
token if any of them changes); a cfg may override them, which is what lets the passing paths be
tested on devnet, and the site refuses to list a token whose cfg has overrides.

| # | Check | Result |
|---|---|---|
| 234 | devnet, stand-ins (test wallet = FOMO signer, DBC = router): creator buy; stranger's plain buy refused; a buy co-signed by the stand-in passes; naming it without a signature is refused; tag on another instruction refused; send and sell open | ✅ |
| 235 | devnet, the route path: router = DBC, tag = an account the swap instruction already lists (the pool): a stranger's plain buy passes | ✅ (DBC's swap rejects an appended account, `InvalidInstructionsSysvar`, so a foreign tag can't be bolted onto it in a test) |
| 236 | devnet, the launcher's own setup (no overrides): plain and tagged-elsewhere buys refused; passes the listing check; the stand-in token is refused a listing | ✅ scripts/e2e-social.mts 17/17 |
| 237 | mainnet, one unlisted test token (`3FXwJJWF…`), real constants, simulated: plain buy refused; the same buy with FOMO's real wallet as a signer passes; naming FOMO without its signature refused; app tags on a direct pool buy refused; jup.ag gets "Failed to get quotes" | ✅ 7/7 |

Not yet seen: a real buy from inside either app on a Social trading token. The FOMO half is the
same test `cosign` has passed with real FOMO buys; the Pump half is the same test `appgate` v3
passed with 27 real Pump-app buys.

Program `social` `DMohCzuYMQUsmYAiitgtYtSpsBtyEw9UWZha7EGqTv8M` (devnet + mainnet).

### Batch 74b — Social trading gates sells as well as buys

By the owner's decision the rule covers both directions: a trade with a Meteora pool (tokens
leaving a vault or entering one) passes only with FOMO's signature or on the Pump app's route;
the creator is exempt both ways; wallet-to-wallet sends are open. Before gating sells: on our
busiest FOMO-only and Pump App only tokens, 515 of 515 real FOMO sells carry FOMO's signature and
364 of 364 real Pump-app sells run through the OKX router with the app tag, so the apps' own
sells pass the same test as their buys.

| # | Check | Result |
|---|---|---|
| 238 | devnet (scripts/e2e-social.mts 22/22): a stranger's plain sell and a sell tagged on another instruction are refused; a sell co-signed by the stand-in passes; the creator sells anywhere; a sell on the stand-in route passes; under the real settings a holder's direct sell is refused | ✅ |
| 239 | mainnet, test token `3FXwJJWF…`, simulated from a throwaway holder with the program's real constants: plain buy and plain sell refused; both pass with FOMO's wallet as a signer; naming FOMO without a signature refused; app tag on a direct trade refused; jup.ag gets "Failed to get quotes" for a buy and for a sell | ✅ 12/12 |

⚠️ There is now no exit outside the two apps. If both stop trading a token (as the router did
with a ticker it disliked, Batch 70) or the tag changes, holders can't sell until the program is
upgraded, and on a permanent curve the rule never lifts by itself.

## Batch 76 — "Skin in the game" (`skin`): the buyer must still hold SOL or USDC after buying

A buy passes only if the buyer, after paying, still holds at least `min_sol` lamports OR at least
`min_usdc` of USDC (either threshold can be 0 = off). Bot farms fund wallets with dust; a real
buyer has a balance. Sells and wallet sends are never gated; the creator is exempt (dev buy);
only the pool's creator can switch the rule on.

How the hook sees the buyer's balances: from the destination token account's owner field
(dest @32) the ExtraAccountMetaList resolves (6) the buyer's wallet with
`PubkeyData::AccountData {2, 32}` (supported by spl-tlv-account-resolution 0.9 and
@solana/spl-token 0.4.15) → its lamports, and (10) the buyer's USDC ATA as an external PDA of
the ATA program, seeds [AccountData{2,32,32}, Token program, USDC mint] → its amount.

| # | Check | Result |
|---|---|---|
| 252 | devnet, real Meteora DBC trades through Hooked's route (scripts/e2e-skin.mts 12/12, stand-in USDC mint) | ✅ |
|  | stranger can't switch it on (`NotCreator`); creator's dev buy passes | ✅ |
|  | 0.05 SOL wallet: no USDC account → refused; 10 USDC → refused; 55 USDC → real buy goes through | ✅ |
|  | 1 SOL wallet buying 0.05 → goes through; 0.54 SOL wallet buying 0.1 (would leave < 0.5) → refused, buying 0.01 → goes through | ✅ |
|  | sell never gated; send to an empty wallet works | ✅ |
| 253 | Meteora's stock DBC SDK (resolves hook extras against the zero address, Batch 44) | ⛔ `TokenTransferHookPubkeyDataTooSmall`: can't build a buy |

Limits:
- **Where it trades:** buyer-derived accounts need a client that resolves the hook against the
  real buyer (Hooked's swap builder does). Like the per-wallet rules retired before launch, it
  should be assumed NOT buyable on Jupiter / Axiom / FOMO until a real aggregator buy proves
  otherwise (can't be tested on devnet).
- **Atomic top-up:** a bot can move SOL/USDC into the buying wallet earlier in the same
  transaction and back out after. It defeats naive dust-wallet farms, not a determined operator.
- The SOL check is the wallet's own lamports at hook time: on a SOL-quoted buy the buy amount is
  already wrapped/paid, so it means "left after the buy". Wrapped SOL and non-ATA USDC accounts
  don't count.

Program `skin` `2zSiLjfBo5t6arSCk5o9UyLGascwyLooGVhdLHcRBsje` (DEVNET only).

### Batch 76b — Skin in the game on mainnet

Deployed `skin` `2zSiLjfBo5t6arSCk5o9UyLGascwyLooGVhdLHcRBsje` to mainnet (slot 452981065, upgrade
authority the deploy wallet). Added to hookedpad.com as a Fair launch rule: the launcher sets the
minimum SOL and minimum USDC (either 0 = off; at least one required); the listing check requires
the real USDC mint `EPjFWdd5…`. Test token `3EsQuShw…` (unlisted) launched through the site's own
code with 0 SOL / 500 USDC (scripts/mainnet-skin-check.mts):

| # | Check | Result |
|---|---|---|
| 254 | creator's own buy, a REAL mainnet Meteora swap: mainnet Token-2022 resolves the buyer's wallet (`PubkeyData`) and USDC ATA (external PDA) and runs the hook | ✅ |
| 255 | a real wallet holding 500+ USDC buys (simulated; SOL doesn't count on this token, so the USDC path) | ✅ passes |
| 256 | a wallet with 0.06 SOL and no USDC; a 0.01 SOL dust wallet | ✅ both `NoSkinInTheGame` |
| 257 | sell | ✅ never gated |
| 258 | Jupiter Ultra buy quote | ⛔ "Failed to get quotes", while yesterday's OpenSea test token quotes through OKX: as predicted, aggregators can't trade it; it trades on its Hooked page |

Program CLOSED on mainnet 2026-10-03 at the owner's request (rule retired after the owner's own test failed); 1.254 SOL rent reclaimed to the deploy wallet. Tokens whose hook points at it (`FwZY4GPb…`, `3EsQuShw…`) can no longer move. Devnet program still deployed.

## Batch 77 — "Ping Pong" (`pingpong`): buys and sells take turns

One shared record per token (cfg ["cfg", mint], WRITABLE extra; plus the Instructions sysvar —
both resolve from the mint alone) holds the last turn-taking trade's direction and streak. A trade
in the same direction is refused once the streak reaches `max_streak` (1 = strict alternation).
- `min_turn` (raw): smaller trades go through only if their direction is allowed anyway and don't
  take the turn, so dust can't farm it.
- One trade of the token per transaction: the hook fingerprints the transaction by hashing the
  Instructions sysvar data minus its trailing 2-byte current index (same for every top-level
  instruction of one transaction, different between transactions), stored with the slot.
- `free_after` seconds without a turn-taking trade frees the turn (0 = never), so a quiet token
  can't stay locked and holders below `min_turn` are never stuck.
- First shot must be a buy (init as if the sells' streak were full). Nobody is exempt, the
  creator included. Wallet sends and pool-to-pool moves are never gated.

| # | Check (devnet, scripts/e2e-pingpong.mts 22/22, real Meteora DBC trades) | Result |
|---|---|---|
| 259 | stranger can't switch it on | ✅ `NotCreator` |
| 260 | strict: first buy; buy after buy refused (creator too); a sell passes the turn; next buy passes, the one after refused | ✅ `SellsTurn` |
| 261 | dust sell (1 token, under 100,000) goes through but doesn't take the turn | ✅ |
| 262 | sell + buy bundled in one transaction | ✅ `OneTradePerTransaction` |
| 263 | wallet-to-wallet send on the wrong turn | ✅ works |
| 264 | a sell built by Meteora's STOCK DBC SDK (no custom resolution) | ✅ real trade: aggregator-style tooling can build it |
| 265 | up to 3 in a row: buys 1-3 pass, 4th refused, a sell resets | ✅ |
| 266 | free after 20 s: a refused buy passes 25 s later | ✅ |

Program `pingpong` `Bf7ecqFieSoacTNbangY4trvnU7bVig6na1RMr6G84dk` (DEVNET only).

### Batch 77b — strictly one buy, one sell

At the owner's request the streak setting was removed: a trade in the same direction as the last
turn-taking trade is always refused (buy, sell, buy, sell). initialize(min_turn, free_after).
Devnet upgraded (slot 507057329); scripts/e2e-pingpong.mts 19/19 with real trades, adding: a sell
right after a sell is refused (`BuysTurn`), then a buy passes and the next buy is refused.

### Batch 77c — Ping Pong on mainnet

Deployed `pingpong` `Bf7ecqFieSoacTNbangY4trvnU7bVig6na1RMr6G84dk` to mainnet (slot 452988493,
upgrade authority the deploy wallet) and added it to hookedpad.com ("Where it trades": launcher
settings minimum to take the turn (% supply) and minutes until a quiet turn frees up; token
pages show a live "Next shot: BUY / SELL"). One unlisted test token `ANYgWS4g…` (0.01% / 10 min):

| # | Check | Result |
|---|---|---|
| 267 | first buy through Hooked's route; a second buy right after | ✅ real buy; ✅ `SellsTurn` |
| 268 | buy + sell bundled in one transaction | ✅ `OneTradePerTransaction` |
| 269 | **real sell through Jupiter Ultra (OKX router) on the sellers' turn** | ✅ executed `49xvWSUD…` |
| 270 | **real buy through Jupiter Ultra (OKX) on the buyers' turn** | ✅ executed `4QxHPzk9…` (under the minimum, so it correctly didn't take the turn) |
| 271 | a brand-new token | ⚠️ Jupiter returned "Failed to get quotes" for ~3 minutes after launch, then routed it |

So unlike Skin in the game, Ping Pong trades through aggregators: its extra accounts resolve from
the mint alone. (The first run's ✕ marks were the test's own sequencing — Jupiter's first quote
came late — and a test sell larger than the curve's liquidity, `InsufficientLiquidity`.)

## Batch 80 — Hot potato (`potato`)

Seen on another launchpad's multi-rule hook (`CrfhZvVd…`, token 68VM5u… "Hot Potato"): rule #32
logs "you hold the hot potato: you can't sell or send until someone buys after you" (36 of 120
recent txs refused). Rebuilt as its own hook: one per-mint cfg (writable, resolves from the mint
alone) holds the holder; a buy of ≥ `min_pass` by another wallet passes the potato to it; the
holder's sells AND sends are refused; optional `free_after` seconds and the potato goes cold
(0 = never, as in the original). Nobody exempt.

| # | Check (devnet, scripts/e2e-potato.mts 13/13, real Meteora trades) | Result |
|---|---|---|
| 288 | stranger can't switch it on | ✅ `NotCreator` |
| 289 | latest buyer holds it: their sell and their send refused; a non-holder sells freely | ✅ `HotPotato` |
| 290 | a dust buy (under the minimum) doesn't pass it; a real buy does, freeing the old holder | ✅ |
| 291 | holder buying again stays the holder | ✅ |
| 292 | a sell built by Meteora's stock SDK | ✅ real trade (aggregator-friendly) |
| 293 | cold after 20 s: the holder sells 25 s later | ✅ |

Program `potato` `CapP1YJk8Rh4d17szh45zXHy8vSMbZoNXfzm6zvNTgz7` (devnet + MAINNET slot 453059339).

## Batch 81 — Blocklist (`blocklist`)

The opposite of Allowlist (from SPEC's "Blocklist": named wallets can never receive the token).
One per-mint list `["list", mint]` (read-only, resolves from the mint alone, so every aggregator
can trade it); every transfer reads the destination owner (raw @32) and refuses it if listed.
Senders are never checked. The DBC pool's creator sets it up — `initialize(capacity ≤ 200)`, `add`
in chunks of 24, `seal` — and it can never change after. Meteora's pool authorities (DBC, DAMM v1,
DAMM v2) and the default key can't be listed.

| # | Check (devnet, hooked/scripts/e2e-blocklist.mts 10/10, real Meteora trades) | Result |
|---|---|---|
| 294 | stranger can't set it up | ✅ `NotCreator` |
| 295 | 61 wallets written in 3 chunks through the site's launch code, sealed, listing check passes | ✅ |
| 296 | a listed wallet can't buy from the pool | ✅ `Blocked` |
| 297 | nobody can send the token to a listed wallet; sends to others pass | ✅ `Blocked` / real transfer |
| 298 | a buy built by Meteora's stock SDK (unlisted wallet) | ✅ real trade (aggregator-friendly) |
| 299 | add after seal | ✅ `Sealed` |
| 300 | Meteora's pool wallet can't be listed | ✅ `PoolWallet` |

Program `blocklist` `8zw1psRFN541E1A3uzxB3uBXjUj3dVtkLHS3Ad99dFqP` (devnet + MAINNET slot 453062179).

## Batch 82 — Trading hours (`schedule`): your days, your hours, any time zone

Market hours' sibling with the timetable chosen by the creator. One per-mint cfg `["hours", mint]`
(read-only, resolves from the mint alone → aggregator-friendly) holds: a weekday mask, one window
per weekday ([open, close) local minutes; open == close = all day; close < open runs past midnight
and belongs to the day it opens), and the time zone as a POSIX-style rule — standard offset, DST
shift, and DST start/end in tzdata's own form ("first <weekday> on or after day D of a month, or
the last one, at a local minute", minute −1440..2880 so a change can sit on the neighbouring day).
No oracle: the hook turns `Clock::unix_timestamp` into local time itself. Trades with a Meteora pool
outside the windows are refused (`Closed`); `sells_open` keeps sells open; wallet sends always work;
the creator can always buy. Pool-creator-only init, fixed after.

Time zones: the site derives the rule from the IANA zone with Intl and verifies it against every
real clock change for six years plus 438 sampled instants. Of 418 IANA zones, 416 map exactly
(0 mismatches at 2,000 random instants each over 5 years), including Chile (Sun>=2), Israel
(Fri>=23), Egypt (last Fri / Thu last + 24:00), Greenland (Sat>=24 23:00), Lord Howe (30-min DST),
southern-hemisphere zones. Morocco / Western Sahara (Ramadan-dependent) have no yearly rule: stored
at the current offset all year, and the launcher says so. Rust unit tests: New York matches Market
hours' own rule every 15 min for 3 years; Sydney, London, Chile, Greenland, India, overnight and
all-day windows, validation, byte round-trip (11/11).

| # | Check (devnet, hooked/scripts/e2e-schedule.mts 16/16, real Meteora trades) | Result |
|---|---|---|
| 301 | stranger can't set it up; a timetable with no days | ✅ `NotCreator` / `BadSchedule` |
| 302 | launched through the site's code (New York, Saturday only, closing 18:36 EDT), listing check | ✅ |
| 303 | inside the window: a buy, and a buy built by Meteora's stock SDK | ✅ real trades |
| 304 | the window shut at 22:36 UTC = 18:36 EDT on the chain clock: buy and sell refused | ✅ `Closed` (DST live) |
| 305 | India (UTC+5:30) closed today: buy and sell refused; creator buys; wallet send works | ✅ |
| 306 | same with sells open: the sell goes through, the buy is still refused | ✅ |

Program `schedule` `BUwCiwrRfVgNKEhHryBb626oKCRqNfm5hhkebrXKG6iY` (devnet + MAINNET slot 453069766).

## Batch 83 — Rules engine (`rules`): one hook program, any rule set (DEVNET)

One program interprets a per-token bytecode rule set on every transfer (stack VM over i128, no
jumps or loops, saturating arithmetic, divide-by-zero = 0; ≤ 4,096 bytes, 64 rules, 64 named
wallets). Rule n refusing = custom error 10000 + n. Bytecode is validated on-chain at `finalize`
(opcodes, operands, stack discipline, declared accounts) and is immutable after.

Every account resolves from the mint alone, so ANY rule set stays aggregator-friendly:
`["rules", mint]` (writable only if counters are used), the DBC pool (fixed pubkey: market cap from
sqrt_price × live supply, curve progress, quote reserve), the Instructions sysvar (priority fee,
Jito tip, `signed_by`, `uses_program`), and `["hist", mint]` — ONE shared table of the most recent
traders (key = first 8 bytes of the owner, first/last buy, last sell, counts; LRU eviction; up to
4,096 entries, grown 10 KB per instruction). That gives per-wallet history (cooldowns, counts)
with no per-wallet accounts; a send copies the sender's buy times to the receiver. Counters in
cfg: holders, total buys/sells, trades/buys this slot, last buyer, last trade side. Local-time
signals reuse `schedule`'s tzdata-style DST rule.

Compiler / simulator / decompiler: hooked/app/lib/node/engine (typed rule language: amounts, SOL,
time, percentages; plain-English reading per rule; on-chain bytecode decompiles back to source and
recompiles byte-identical). Offline: scripts/test-engine.mts (34 checks).

| # | Check (devnet, hooked/scripts/e2e-rules.mts 19/19 + e2e-custom.mts 3/3, real Meteora trades) | Result |
|---|---|---|
| 307 | stranger can't set rules; invalid bytecode refused at finalize; no rewrite once live | ✅ `NotCreator` / `BadRules` / `Live` |
| 308 | 7 rules using all four extra accounts set up in ONE transaction (600-entry history table grown past 10 KB) | ✅ |
| 309 | on-chain bytecode decompiles to the source rules | ✅ |
| 310 | buy cap with creator exemption (rule 1), named-wallet block (rule 5) | ✅ refused with the right rule number |
| 311 | wallet history: no sell within 40 s of buying; cooldown follows a send to another wallet; sell passes after 45 s | ✅ |
| 312 | transaction signal: buy paying 0.002 SOL priority fee refused | ✅ rule 3 |
| 313 | buy built by Meteora's stock SDK with all four extras | ✅ real trade (aggregator-friendly) |
| 314 | counters: 3 buys, 1 sell, 3 holders, last buyer | ✅ |
| 315 | pool signal: buys refused once a real buy pushed market cap past 2.2 SOL | ✅ |
| 316 | launched via the site's launch path; listing refuses rule text that doesn't compile to the on-chain bytecode | ✅ |

Program `rules` `9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL` (devnet + MAINNET slot 453086888; 329,280 bytes, 1.67 SOL rent). Mainnet sim: stranger setup refused `NotCreator`.

## Batch 84 — Conviction cap, rebuilt on the rules engine (any DEX)

The Batch 59 conviction cap (`drip` mode 6) needed a per-wallet slot, so it only traded through the
launchpad's own route. As one rule on the `rules` engine it needs no per-wallet account:

`refuse if is_buy and not trader is creator and amount > min(S% + min(receiver_seconds_held, receiver_seconds_since_sell) / 1d * G%, M%)`

Holding streak = min(time since first buy, time since last sell), from the shared history table.
Differences from mode 6: a send doesn't reset the streak (it carries the buy times to the
receiver), and a wallet evicted from the table restarts at the starting cap. No program change.

| # | Check (devnet, hooked/scripts/e2e-conviction.mts 11/11, real Meteora trades) | Result |
|---|---|---|
| 317 | named rule via the site's launch path; listing refuses settings that don't match the chain | ✅ |
| 318 | new wallet: 0.049% buy passes, ~0.25% buy refused; creator's 2.9% buy passes | ✅ rule 1 |
| 319 | fast copy (20 s step): 0.15% buy refused at once, passes after holding 45 s | ✅ the cap grew on-chain |
| 320 | after a sell the 0.15% buy is refused again; a 0.05% buy still passes | ✅ selling resets it |

Decompiler fix: `x / <constant>` reads back as "divided by the same unit" (`/ 1d`) when the plain
reading doesn't type-check, so the rule round-trips.

## Batch 86 — King of the Hill (`king`, DEVNET): the biggest buy holds a crown that earns the pool's creator fee

The crown is a hook; the King's pay is the pool's own fee, routed trustlessly.

- **325** a hook can value a buy in SOL: tokens × the pool's sqrt price (pool passed as a fixed
  extra account). alice's 0.02 SOL buy (1.5% fee) was valued at 0.019876 SOL.
- **326** a DBC pool's creator role can be handed to a PROGRAM: `transfer_pool_creator` CPI'd from
  `initialize` with the creator's signature, new creator = PDA `["throne", mint]` (a system account).
- **327** that PDA can claim the creator share of trading fees by CPI — but for a transfer-hook pool
  only via `claim_creator_trading_fee2` (the plain one fails `PoolTypeMismatch`). With fees
  collected in quote only, `max_base_amount = 0` and an empty `TransferHookAccountsInfo`, nothing of
  the hooked token moves, so the hook program is never re-entered from its own `payout`.
- **328** exact per-reign attribution with no keeper: at every change of King the hook reads the
  pool's pending `creator_quote_fee` (@360) and credits (pending + already claimed − already
  accounted) to the outgoing King; vacant-throne fees go to a pot the next King gets. `payout(wallet)`
  is permissionless: settle → open WSOL ATA (treasury pays its own rent) → claim → close (unwrap) →
  system transfer. Books balanced to the lamport after 3 payouts.
- **329** DBC takes a 20% protocol cut before the partner/creator split: a 1.5% fee with creator
  share 33% pays Kings 0.396% of volume, the partner 0.804%, Meteora 0.300%.
- BPF loader: an upgrade that grows a program by < 10,240 bytes fails inside `deploy`
  (auto-extend refuses small amounts); `solana program extend <id> 10240` first.

Game rules (state `["king", mint]`, 64-entry Hall): bar = winning bid halved every `half_life`
(linear within a half-life), floor `min_buy`; challenger needs bar × (1 + step); the King's own
bigger buy raises the bid; any transfer out of the King's wallet = abdication; launcher excluded
unless allowed.

Devnet hooked/scripts/e2e-king.mts 21/21 (real Meteora trades incl. a stock-SDK buy; decay over
70 s; abdication; pot; three payouts). Unit tests 5/5. Program `king`
`63VLLdKEZVjwKN4Y6CqeeFkLGzMoSZxFAXsfiLwnKKkD` (devnet + MAINNET slot 453349346). Shipped with a 1.65% pool fee and a 38% creator share: measured King 0.502% of volume, partner 0.818%, Meteora 0.33%.

## Batch 87 — The engine learns every allow/refuse hook, and runs King of the Hill inside a rule set (devnet + MAINNET slot 453375810)

So a Custom hook can mix any of them:
- **King of the Hill in the engine** (`F_KING`): `init_king` (before `finalize`) creates the game
  state `["king", mint]` under the rules program and hands the pool's creator role to its treasury
  `["throne", mint]`; the hook runs `kinggame::on_transfer` after the rules pass; `king_payout` =
  `king::payout`. The game logic is `kinggame.rs`, generated from programs/king. Rules get
  `sender/receiver/trader_is_king`, `king_bid`, `king_bar`, `king_reign`. Five extra accounts
  (cfg, pool, hist, king + the list) still trade through Meteora's stock SDK.
- **`buy_value`** (SOL value of a buy at the pool price), **`volume_bought/sold/volume`** (cfg layout
  1: header 256 bytes, body after; layout 0 tokens untouched) → Chapters as rules;
  **`us_market_holiday`** (NYSE calendar from programs/hours, New York date) → Market hours as rules.
- **`trade_program is`, `trade_lists`, `memo is "…"`**: the top-level instruction running the transfer
  (`load_current_index_checked`) and the transaction's memos → Pump App only, Social trading and
  OpenSea only as rules (`via_pump_app`, `via_fomo`, `via_opensea`).
- Not expressible (they do more than allow/refuse): Pegs, Physics, Buyer rewards, Dividends, Tithe,
  Holder vesting, Holder-gated, Reactive, Entangled/Beacon.

Devnet (slot 507491633, program 454,024 bytes): unit tests 14/14; hooked/scripts/e2e-engine-king.mts
14/14 (real Meteora trades: 5 rules + the game on one token, cooldown from history, buy-value rule,
a rule on the King's reign, payout exact, stock-SDK buy); e2e-rules 19/19; e2e-custom 3/3; two tokens
from before the upgrade (layout 0) still transfer. All 36 recipes in the AI reference compile,
validate and round-trip (scripts/test-recipes.mts).

## Batch 88 — Editable rule sets: a token whose rules can be replaced after launch (DEVNET slot of 2026-10-04, program 520,416 bytes)

Two Hooked launch options on top of the engine: **Editable hook** (the creator rewrites the rules
whenever they like) and **DAO hook** (holders vote; a keeper applies what passes).

- `set_editable(authority, delay)`: creator only, before `finalize`, never afterwards. Stores the
  one wallet that may change the rules (cfg @208), a notice period in seconds (@240, max 30 days),
  a change counter (@244) and the time of the last change (@248). All zero = fixed for good, which
  is what every token from before this batch reads as.
- **The account list never changes.** An editable rule set must be launched with every optional
  account (`EDIT_FLAGS` = state + pool + instructions + history; no King of the Hill, whose fee split
  is fixed in the pool config). Later rule sets are validated against those same flags, so the
  ExtraAccountMetaList written at launch stays right whatever the rules become, and routers never
  see it move. The history table's size is the one thing fixed at launch.
- Change = `propose` (allocates `["next", mint]`; uses transfer + allocate + assign, not
  create_account, so nobody can block changes by sending the address lamports) → `write_next`
  (chunks) → `seal` (validates the bytecode, stamps the time) → `apply` (after the notice period;
  permissionless, because sealing was the authorisation; resizes cfg, copies the body, bumps the
  counter, closes `next` and returns its rent to whoever paid) or `cancel` (authority only).
  A rule set may be empty (`PUSH0 REFUSE_IF`).
- The pending rule set is a normal account: anyone can read and decompile it during the notice
  period, which is the point of the notice period.
- Site: the listing check refuses an editable token registered as a fixed Custom hook (and the
  reverse), checks the authority is the creator (Editable) or Hooked's keeper (DAO), and checks the
  notice period. The token page reads the live rules from the chain, never from the registry.
- Fees: these tokens' claimed fees split 15% dev / 5% the token's own fund / 80% buyback. The fund
  is a per-token ledger over SOL that stays in the flywheel wallet; it pays the AI builder and, for
  DAO tokens, the keeper's transactions.

Devnet: hooked/scripts/e2e-editable.mts 26/26 (real Meteora trades: three creator changes incl. a
60-rule set over several transactions and an empty one, a stranger refused, keeper-only token,
20 s notice: TooEarly, cancel, applied by a stranger with the rent going back to the keeper).
hooked/scripts/e2e-dao.mts 22/22 (flywheel credits exactly 5% of the pool's claimed fees and takes
it out of the buyback share; signed posts and votes with balance checks; the AI builder writes the
rule set for a passed idea and the keeper applies it; an idea that would lock holders in is not
carried out; a voter who moved their tokens away no longer counts). e2e-custom 3/3 and
e2e-conviction still pass on the upgraded program; unit tests 14/14.
